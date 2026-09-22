// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import type { PaidOverageStatus } from "@/services/paidOverage";

const services = vi.hoisted(() => ({
  getConsent: vi.fn(),
  updateConsent: vi.fn(),
  getUsage: vi.fn(),
  promptForConsent: vi.fn(),
}));

vi.mock("@/services/paidOverage", () => ({
  default: {
    get: services.getConsent,
    update: services.updateConsent,
  },
}));

vi.mock("@/services/billings", () => ({
  default: { get_ai_usage: services.getUsage },
}));

vi.mock("@/composables/usePaidOverageConsent", () => ({
  usePaidOverageConsent: () => ({ promptForConsent: services.promptForConsent }),
}));

import PaidUsageSettings from "./PaidUsageSettings.vue";

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

function mountSettings() {
  return mount(PaidUsageSettings, {
    global: {
      plugins: [store, i18n],
      stubs: {
        OPageLayout: { template: "<main><slot /></main>" },
        OSpinner: { template: '<div data-test="spinner" />' },
        OSwitch: {
          name: "OSwitch",
          props: ["modelValue", "disabled", "label"],
          emits: ["update:modelValue"],
          template:
            '<button data-test="paid-usage-ai-credits-toggle" :disabled="disabled" @click="$emit(\'update:modelValue\', !modelValue)">{{ label }}</button>',
        },
      },
    },
  });
}

describe("PaidUsageSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.state.selectedOrganization.identifier = "default";
    services.getUsage.mockResolvedValue({
      data: {
        credits_used: 100,
        credits_limit: 100,
        credits_remaining: 0,
        mode: "consent_required",
        requires_additional_credits: false,
      },
    });
    services.updateConsent.mockResolvedValue({ data: consentStatus() });
    services.promptForConsent.mockResolvedValue(true);
  });

  it("shows one cumulative AI Credits permission without internal row names", async () => {
    services.getConsent.mockResolvedValue({ data: consentStatus() });
    const wrapper = mountSettings();
    await flushPromises();

    expect(wrapper.text()).toContain("AI Credits");
    expect(wrapper.text()).not.toContain("ai_chat");
    expect(wrapper.text()).not.toContain("new_incident");
    expect(wrapper.text()).not.toContain("incident_reanalysis");
  });

  it("keeps the control read-only for non-admins", async () => {
    services.getConsent.mockResolvedValue({
      data: consentStatus({
        organization: { org_id: "default", enabled: false, can_manage: false },
      }),
    });
    const wrapper = mountSettings();
    await flushPromises();

    expect(
      wrapper.get('[data-test="paid-usage-ai-credits-toggle"]').attributes("disabled"),
    ).toBeDefined();
    expect(wrapper.text()).toContain("Only an organization administrator");
  });

  it("uses the checked consent dialog before enabling", async () => {
    services.getConsent.mockResolvedValue({ data: consentStatus() });
    const wrapper = mountSettings();
    await flushPromises();

    await wrapper.get('[data-test="paid-usage-ai-credits-toggle"]').trigger("click");
    await flushPromises();

    expect(services.promptForConsent).toHaveBeenCalledWith(
      "default",
      "ai_credits",
      expect.objectContaining({ feature: "ai_credits" }),
    );
    expect(services.updateConsent).not.toHaveBeenCalled();
  });

  it("restores the disabled switch when consent is declined", async () => {
    services.getConsent.mockResolvedValue({ data: consentStatus() });
    services.promptForConsent.mockResolvedValue(false);
    const wrapper = mountSettings();
    await flushPromises();

    await wrapper.get('[data-test="paid-usage-ai-credits-toggle"]').trigger("click");
    await flushPromises();

    expect(wrapper.getComponent({ name: "OSwitch" }).props("modelValue")).toBe(false);
    expect(services.updateConsent).not.toHaveBeenCalled();
  });

  it("keeps paid usage disabled when billing is not eligible", async () => {
    services.getConsent.mockResolvedValue({
      data: consentStatus({ billing_status: "subscription_required" }),
    });
    const wrapper = mountSettings();
    await flushPromises();

    expect(
      wrapper.get('[data-test="paid-usage-ai-credits-toggle"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("disables cumulative consent directly", async () => {
    services.getConsent.mockResolvedValue({
      data: consentStatus({
        organization: { org_id: "default", enabled: true, can_manage: true },
        effective: true,
      }),
    });
    const wrapper = mountSettings();
    await flushPromises();

    await wrapper.get('[data-test="paid-usage-ai-credits-toggle"]').trigger("click");
    await flushPromises();

    expect(services.updateConsent).toHaveBeenCalledWith("default", "ai_credits", false);
  });

  it("names the payer billing cycle for an enabled member", async () => {
    services.getConsent.mockResolvedValue({
      data: consentStatus({
        organization: { org_id: "member", enabled: true, can_manage: true },
        payer: { org_id: "payer", enabled: true, can_manage: false },
        effective: true,
      }),
    });
    const wrapper = mountSettings();
    await flushPromises();

    expect(wrapper.get('[data-test="paid-usage-settings-billing-cycle-copy"]').text()).toBe(
      "Paid AI usage is added to the payer organization’s current billing cycle.",
    );
  });
});

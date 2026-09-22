// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import type { PaidOverageStatus } from "@/services/paidOverage";

const router = vi.hoisted(() => ({ push: vi.fn() }));
const controller = vi.hoisted(() => ({ accept: vi.fn(), decline: vi.fn() }));

vi.mock("vue-router", () => ({ useRouter: () => router }));

const activeRequest = ref<{ status: PaidOverageStatus } | null>(null);
const acknowledgementChecked = ref(false);
const canEnable = ref(true);

vi.mock("@/composables/usePaidOverageConsent", () => ({
  usePaidOverageConsent: () => ({
    activeRequest,
    acknowledgementChecked,
    isSubmitting: ref(false),
    errorMessage: ref(""),
    canEnable,
    accept: controller.accept,
    decline: controller.decline,
  }),
}));

import PaidOverageConsentDialog from "./PaidOverageConsentDialog.vue";

function status(overrides: Partial<PaidOverageStatus> = {}): PaidOverageStatus {
  return {
    feature: "ai_credits",
    organization: { org_id: "default", enabled: false, can_manage: true },
    payer: null,
    effective: false,
    billing_status: "eligible",
    ...overrides,
  };
}

function mountDialog() {
  return mount(PaidOverageConsentDialog, {
    global: {
      plugins: [store, i18n],
      stubs: {
        ODialog: {
          props: ["open", "primaryButtonDisabled"],
          template: '<section v-if="open"><slot /></section>',
        },
        OButton: {
          props: ["variant", "size"],
          emits: ["click"],
          template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
        },
        OCheckbox: {
          props: ["modelValue", "label"],
          template: '<label data-test="paid-overage-authorization-checkbox">{{ label }}</label>',
        },
      },
    },
  });
}

describe("PaidOverageConsentDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.state.selectedOrganization.identifier = "default";
    acknowledgementChecked.value = false;
    canEnable.value = true;
    activeRequest.value = { status: status() };
  });

  it("presents one cumulative AI Credits permission without internal row names", () => {
    const text = mountDialog().text();
    expect(text).toContain(i18n.global.t("paidUsage.aiCredits"));
    for (const row of ["ai_chat", "new_incident", "incident_reanalysis"]) {
      expect(text).not.toContain(row);
    }
  });

  it("names the organization's own billing cycle for direct billing", () => {
    const wrapper = mountDialog();
    expect(wrapper.find('[data-test="paid-overage-billing-cycle-copy"]').text()).toContain(
      i18n.global.t("paidUsage.organizationBillingCycle"),
    );
  });

  it("names the payer's billing cycle when a payer is present", () => {
    activeRequest.value = {
      status: status({ payer: { org_id: "payer", enabled: false, can_manage: true } }),
    };
    const wrapper = mountDialog();
    expect(wrapper.find('[data-test="paid-overage-billing-cycle-copy"]').text()).toContain(
      i18n.global.t("paidUsage.payerBillingCycle"),
    );
  });

  // The prompt has no stable per-credit rate to show, so Billing is the price source.
  it("links to billing and writes nothing on the way out", async () => {
    const wrapper = mountDialog();
    await wrapper.find('[data-test="paid-overage-view-billing"]').trigger("click");
    await flushPromises();

    expect(controller.accept).not.toHaveBeenCalled();
    expect(controller.decline).toHaveBeenCalledOnce();
    expect(router.push).toHaveBeenCalledWith({
      name: "plans",
      query: { org_identifier: "default" },
    });
  });

  it("offers no enable action when a required organization is unmanageable", () => {
    canEnable.value = false;
    const wrapper = mountDialog();
    expect(wrapper.find('[data-test="paid-overage-authorization-checkbox"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="paid-overage-contact-admin"]').exists()).toBe(true);
  });
});

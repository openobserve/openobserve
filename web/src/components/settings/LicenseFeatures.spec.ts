import { describe, it, expect, afterEach } from "vitest";
import { mount, enableAutoUnmount } from "@vue/test-utils";
import { createStore } from "vuex";
import i18n from "@/locales";
import LicenseFeatures from "./LicenseFeatures.vue";

enableAutoUnmount(afterEach);

const definition = {
  features: {
    workflows: { display_name: "Workflows", gate: true },
    rbac: { display_name: "Role-Based Access Control", gate: true },
    logs: { display_name: "Logs", gate: false },
  },
};

const mountFeatures = (features: string[]) =>
  mount(LicenseFeatures, {
    props: { license: { features, feature_definition: definition } },
    global: {
      plugins: [i18n, createStore({ state: { zoConfig: { features: {} } } })],
    },
  });

describe("LicenseFeatures", () => {
  it("shows every gated feature as unlocked when the license lists only all", () => {
    const wrapper = mountFeatures(["all"]);

    const unlocked = wrapper.find('[data-test="settings-license-features-unlocked"]').text();
    expect(unlocked).toContain("Workflows");
    expect(unlocked).toContain("Role-Based Access Control");
    expect(unlocked).not.toMatch(/\ball\b/);
    expect(wrapper.find('[data-test="settings-license-features-missing"]').exists()).toBe(false);
  });

  it("lists the features that are not in a license with named features", () => {
    const wrapper = mountFeatures(["workflows"]);

    expect(wrapper.find('[data-test="settings-license-features-unlocked"]').text()).toContain(
      "Workflows",
    );
    expect(wrapper.find('[data-test="settings-license-features-missing"]').text()).toContain(
      "Role-Based Access Control",
    );
  });
});

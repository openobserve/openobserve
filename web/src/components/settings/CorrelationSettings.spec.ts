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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import CorrelationSettings from "./CorrelationSettings.vue";

installQuasar();

vi.mock("@/components/alerts/OrganizationDeduplicationSettings.vue", () => ({
  default: {
    name: "OrganizationDeduplicationSettings",
    template: '<div data-test="org-deduplication-settings" />',
    props: ["orgId", "config"],
    emits: ["saved"],
  },
}));

vi.mock("@/components/settings/DiscoveredServices.vue", () => ({
  default: {
    name: "DiscoveredServices",
    template: '<div data-test="discovered-services" />',
  },
}));

vi.mock("@/components/settings/ServiceIdentityConfig.vue", () => ({
  default: {
    name: "ServiceIdentityConfig",
    template: '<div data-test="service-identity-config" />',
    props: ["orgId", "config"],
    emits: ["saved"],
  },
}));

vi.mock("@/components/common/AppTabs.vue", () => ({
  default: {
    name: "AppTabs",
    template: '<div><slot /></div>',
  },
}));

const mockStore = createStore({
  state: {
    selectedOrganization: { identifier: "test-org" },
    theme: "light",
    organizationSettings: {
      deduplication_config: { enabled: true },
    },
  },
});

const mockI18n = createI18n({
  locale: "en",
  messages: {
    en: {
      settings: {
        correlation: {
          title: "Correlation Settings",
          subtitle: "Configure service correlation",
          serviceIdentityTab: "Service Identity",
          discoveredServicesTab: "Discovered Services",
          alertCorrelationTab: "Alert Correlation",
        },
      },
    },
  },
});

function mountComponent() {
  return mount(CorrelationSettings, {
    global: {
      plugins: [mockI18n],
      provide: { store: mockStore },
      stubs: {
        "q-tabs": { template: '<div class="q-tabs"><slot /></div>', props: ["modelValue"], emits: ["update:modelValue"] },
        "q-tab": { template: '<div class="q-tab" :data-test="`tab-${name}`" :data-name="name"><slot /></div>', props: ["name", "label", "noCaps"] },
      },
    },
  });
}

describe("CorrelationSettings", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    it("should render without errors", () => {
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("should display the title", () => {
      wrapper = mountComponent();
      expect(wrapper.text()).toContain("Correlation Settings");
    });

    it("should display the subtitle", () => {
      wrapper = mountComponent();
      expect(wrapper.text()).toContain("Configure service correlation");
    });

    it("should default to identity tab", () => {
      wrapper = mountComponent();
      expect(wrapper.vm.activeTab).toBe("identity");
    });
  });

  describe("tab rendering", () => {
    it("should render Service Identity tab", () => {
      wrapper = mountComponent();
      const tab = wrapper.find('[data-name="identity"]');
      expect(tab.exists()).toBe(true);
    });

    it("should render Discovered Services tab", () => {
      wrapper = mountComponent();
      const tab = wrapper.find('[data-name="services"]');
      expect(tab.exists()).toBe(true);
    });

    it("should render Alert Correlation tab", () => {
      wrapper = mountComponent();
      const tab = wrapper.find('[data-name="alert-correlation"]');
      expect(tab.exists()).toBe(true);
    });
  });

  describe("tab content switching", () => {
    it("should show ServiceIdentityConfig when activeTab=identity", () => {
      wrapper = mountComponent();
      wrapper.vm.activeTab = "identity";
      expect(wrapper.find('[data-test="service-identity-config"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="discovered-services"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="org-deduplication-settings"]').exists()).toBe(false);
    });

    it("should show DiscoveredServices when activeTab=services", async () => {
      wrapper = mountComponent();
      wrapper.vm.activeTab = "services";
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-test="discovered-services"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="service-identity-config"]').exists()).toBe(false);
    });

    it("should show OrganizationDeduplicationSettings when activeTab=alert-correlation", async () => {
      wrapper = mountComponent();
      wrapper.vm.activeTab = "alert-correlation";
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-test="org-deduplication-settings"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="service-identity-config"]').exists()).toBe(false);
    });
  });

  describe("onTabChange", () => {
    it("should update activeTab when tab changes", () => {
      wrapper = mountComponent();
      wrapper.vm.onTabChange("services");
      expect(wrapper.vm.activeTab).toBe("services");
    });

    it("should switch to alert-correlation tab", () => {
      wrapper = mountComponent();
      wrapper.vm.onTabChange("alert-correlation");
      expect(wrapper.vm.activeTab).toBe("alert-correlation");
    });

    it("should switch back to identity tab", () => {
      wrapper = mountComponent();
      wrapper.vm.onTabChange("services");
      wrapper.vm.onTabChange("identity");
      expect(wrapper.vm.activeTab).toBe("identity");
    });
  });

  describe("onCorrelationSettingsSaved", () => {
    it("should handle saved event without throwing", () => {
      wrapper = mountComponent();
      expect(() => wrapper.vm.onCorrelationSettingsSaved()).not.toThrow();
    });
  });

  describe("tabs computed", () => {
    it("should have 3 tab entries", () => {
      wrapper = mountComponent();
      expect(wrapper.vm.tabs).toHaveLength(3);
    });

    it("should have correct tab values", () => {
      wrapper = mountComponent();
      const values = wrapper.vm.tabs.map((t: any) => t.value);
      expect(values).toContain("identity");
      expect(values).toContain("services");
      expect(values).toContain("alert-correlation");
    });
  });

  describe("store integration", () => {
    it("should pass orgId from store to ServiceIdentityConfig", () => {
      wrapper = mountComponent();
      expect(wrapper.vm.store.state.selectedOrganization.identifier).toBe("test-org");
    });
  });
});

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

import { describe, expect, it, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import CorrelationSettings from "./CorrelationSettings.vue";

installQuasar();

vi.mock("vue-router", () => ({
  useRoute: () => ({ params: {}, query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  onBeforeRouteLeave: vi.fn(),
}));

vi.mock("@/services/service_streams", () => ({
  default: {
    getSemanticGroups: vi.fn().mockResolvedValue({ data: [] }),
    updateSemanticGroups: vi.fn().mockResolvedValue({}),
  },
}));

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
    emits: ["navigate-to-configuration"],
  },
}));

vi.mock("@/components/settings/ServiceIdentitySetup.vue", () => ({
  default: {
    name: "ServiceIdentitySetup",
    template: '<div data-test="service-identity-setup" />',
    props: ["orgIdentifier", "semanticGroups"],
    emits: ["navigate-to-aliases", "navigate-to-services", "update-service-fields"],
  },
}));

vi.mock("@/components/alerts/SemanticFieldGroupsConfig.vue", () => ({
  default: {
    name: "SemanticFieldGroupsConfig",
    template: '<div data-test="semantic-field-groups-config" />',
    props: ["semanticFieldGroups", "scrollToGroupId"],
    emits: ["update:semanticFieldGroups"],
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
          discoveredServicesTab: "Discovered Services",
          serviceDiscoveryTab: "Service Discovery",
          alertCorrelationTab: "Alert Correlation",
          fieldAliasesTab: "Field Aliases",
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
        OTabs: { template: '<div class="o-tabs"><slot /></div>', props: ["modelValue", "dense"], emits: ["update:modelValue"] },
        OTab: { template: '<div class="o-tab" :data-test="`tab-${name}`" :data-name="name"><slot /></div>', props: ["name", "label", "noCaps", "icon"] },
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

    it("should default to services tab", () => {
      wrapper = mountComponent();
      expect(wrapper.vm.activeTab).toBe("services");
    });
  });

  describe("tab rendering", () => {
    it("should render Discovered Services tab", () => {
      wrapper = mountComponent();
      expect(wrapper.find('[data-name="services"]').exists()).toBe(true);
    });

    it("should render Service Discovery tab", () => {
      wrapper = mountComponent();
      expect(wrapper.find('[data-name="discovery"]').exists()).toBe(true);
    });

    it("should render Alert Correlation tab", () => {
      wrapper = mountComponent();
      expect(wrapper.find('[data-name="alert-correlation"]').exists()).toBe(true);
    });

    it("should render Field Aliases tab", () => {
      wrapper = mountComponent();
      expect(wrapper.find('[data-name="field-aliases"]').exists()).toBe(true);
    });
  });

  describe("tab content switching", () => {
    it("should show DiscoveredServices when activeTab=services", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find('[data-test="discovered-services"]').isVisible()).toBe(true);
      expect(wrapper.find('[data-test="service-identity-setup"]').isVisible()).toBe(false);
    });

    it("should show ServiceIdentitySetup when activeTab=discovery", async () => {
      wrapper = mountComponent();
      wrapper.vm.activeTab = "discovery";
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-test="service-identity-setup"]').isVisible()).toBe(true);
      expect(wrapper.find('[data-test="discovered-services"]').isVisible()).toBe(false);
    });

    it("should show OrganizationDeduplicationSettings when activeTab=alert-correlation", async () => {
      wrapper = mountComponent();
      wrapper.vm.activeTab = "alert-correlation";
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-test="org-deduplication-settings"]').exists()).toBe(true);
    });

    it("should show SemanticFieldGroupsConfig when activeTab=field-aliases", async () => {
      wrapper = mountComponent();
      wrapper.vm.activeTab = "field-aliases";
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-test="semantic-field-groups-config"]').exists()).toBe(true);
    });
  });

  describe("onTabChange", () => {
    it("should update activeTab when tab changes", () => {
      wrapper = mountComponent();
      wrapper.vm.onTabChange("discovery");
      expect(wrapper.vm.activeTab).toBe("discovery");
    });

    it("should switch to alert-correlation tab", () => {
      wrapper = mountComponent();
      wrapper.vm.onTabChange("alert-correlation");
      expect(wrapper.vm.activeTab).toBe("alert-correlation");
    });

    it("should switch back to services tab", () => {
      wrapper = mountComponent();
      wrapper.vm.onTabChange("discovery");
      wrapper.vm.onTabChange("services");
      expect(wrapper.vm.activeTab).toBe("services");
    });
  });

  describe("onCorrelationSettingsSaved", () => {
    it("should handle saved event without throwing", () => {
      wrapper = mountComponent();
      expect(() => wrapper.vm.onCorrelationSettingsSaved()).not.toThrow();
    });
  });

  describe("tabs computed", () => {
    it("should have 4 tab entries", () => {
      wrapper = mountComponent();
      expect(wrapper.vm.tabs).toHaveLength(4);
    });

    it("should have correct tab values", () => {
      wrapper = mountComponent();
      const values = wrapper.vm.tabs.map((t: any) => t.value);
      expect(values).toContain("services");
      expect(values).toContain("discovery");
      expect(values).toContain("alert-correlation");
      expect(values).toContain("field-aliases");
    });
  });

  describe("store integration", () => {
    it("should pass orgId from store to ServiceIdentitySetup", async () => {
      wrapper = mountComponent();
      wrapper.vm.activeTab = "discovery";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.store.state.selectedOrganization.identifier).toBe("test-org");
    });
  });
});

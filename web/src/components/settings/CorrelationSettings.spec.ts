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
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import CorrelationSettings from "./CorrelationSettings.vue";
import { queryClient } from "@/composables/query/queryClient";
import serviceStreamsService from "@/services/service_streams";
import { serviceStreamKeys } from "@/services/service_streams.querykeys";
import { onBeforeRouteLeave } from "vue-router";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { beginDraftSignOut, cancelDraftSignOut } from "@/utils/drafts/draftSession";

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
    emits: ["navigate-to-aliases", "navigate-to-services"],
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
    template: "<div><slot /></div>",
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

function mountComponent(store = mockStore) {
  return mount(CorrelationSettings, {
    global: {
      plugins: [mockI18n],
      provide: { store },
      stubs: {
        OTabs: {
          template: '<div class="o-tabs"><slot /></div>',
          props: ["modelValue", "dense"],
          emits: ["update:modelValue"],
        },
        OTab: {
          template:
            '<div class="o-tab" :data-test="`tab-${name}`" :data-name="name" :data-suffix="suffixIcon"><slot /></div>',
          props: ["name", "label", "noCaps", "icon", "suffixIcon"],
        },
        LicenseDeniedState: {
          name: "LicenseDeniedState",
          props: ["features"],
          template: '<div class="license-denied" :data-features="features.join(\',\')" />',
        },
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

  describe("license locks", () => {
    const storeWith = (features: Record<string, string>) =>
      createStore({ state: { ...mockStore.state, zoConfig: { features } } });
    const deniedFeatures = () =>
      wrapper.findAll(".license-denied").map((d) => d.attributes("data-features"));

    it("locks only the services and discovery tabs when correlation is locked", async () => {
      wrapper = mountComponent(storeWith({ correlation: "locked" }));
      await flushPromises();

      expect(deniedFeatures()).toEqual(["correlation", "correlation"]);
      expect(wrapper.find('[data-test="discovered-services"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="service-identity-setup"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="org-deduplication-settings"]').exists()).toBe(true);
      expect(wrapper.find('[data-name="services"]').attributes("data-suffix")).toBe("lock");
      expect(wrapper.find('[data-name="discovery"]').attributes("data-suffix")).toBe("lock");
      expect(wrapper.find('[data-name="field-aliases"]').attributes("data-suffix")).toBeUndefined();
      expect(serviceStreamsService.getSemanticGroups).toHaveBeenCalled();
    });

    it("locks alert correlation and field aliases, and skips semantic groups, when alerts is locked", async () => {
      wrapper = mountComponent(storeWith({ alerts: "locked" }));
      await flushPromises();

      expect(deniedFeatures()).toEqual(["alerts", "alerts"]);
      expect(wrapper.find('[data-test="org-deduplication-settings"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="semantic-field-groups-config"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="discovered-services"]').exists()).toBe(true);
      expect(wrapper.find('[data-name="alert-correlation"]').attributes("data-suffix")).toBe(
        "lock",
      );
      expect(serviceStreamsService.getSemanticGroups).not.toHaveBeenCalled();
    });

    it("renders every tab unlocked when both features are enabled", async () => {
      wrapper = mountComponent(storeWith({ correlation: "enabled", alerts: "enabled" }));
      await flushPromises();

      expect(deniedFeatures()).toEqual([]);
      expect(wrapper.findAll("[data-suffix]")).toHaveLength(0);
    });
  });

  describe("initial render", () => {
    it("should render without errors", () => {
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the section (title is provided by the Settings shell)", () => {
      wrapper = mountComponent();
      expect(wrapper.find('[data-test="correlation-settings-tabs"]').exists()).toBe(true);
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

  // The groups are cached, and dimension analytics is computed from them, so a save expires the whole scope.
  describe("saving field aliases", () => {
    const scope = { queryKey: serviceStreamKeys.all("test-org") };

    it("expires the service-correlation cache after a successful save", async () => {
      const spy = vi.spyOn(queryClient, "invalidateQueries");
      wrapper = mountComponent();
      await flushPromises();
      (wrapper.vm as any).draftSemanticGroups = [{ display: "Host", group: "", fields: ["host"] }];
      await (wrapper.vm as any).saveSemanticGroups();

      expect(spy).toHaveBeenCalledWith(scope);
      spy.mockRestore();
    });

    it("leaves the cache alone when the save fails", async () => {
      vi.mocked(serviceStreamsService.updateSemanticGroups).mockRejectedValueOnce(
        new Error("boom"),
      );
      const spy = vi.spyOn(queryClient, "invalidateQueries");
      wrapper = mountComponent();
      await flushPromises();
      (wrapper.vm as any).draftSemanticGroups = [{ display: "Host", group: "", fields: ["host"] }];
      await (wrapper.vm as any).saveSemanticGroups();

      expect(spy).not.toHaveBeenCalledWith(scope);
      spy.mockRestore();
    });
  });

  describe("leaving with unsaved field aliases", () => {
    it("a forced sign-out offers only Discard, which cannot be dismissed", async () => {
      wrapper = mountComponent();
      await flushPromises();
      (wrapper.vm as unknown as { draftSemanticGroups: unknown[] }).draftSemanticGroups = [
        { display: "Host", group: "", fields: ["host"] },
      ];
      const guard = vi.mocked(onBeforeRouteLeave).mock.calls[0][0] as () => Promise<boolean>;
      const { currentDialog, handleConfirm } = useConfirmDialog();
      beginDraftSignOut({ forced: true });
      try {
        const leave = guard();
        await flushPromises();
        expect(currentDialog.value).toMatchObject({ confirmOnly: true });
        handleConfirm();
        expect(await leave).toBe(true);
      } finally {
        cancelDraftSignOut();
      }
    });
  });
});

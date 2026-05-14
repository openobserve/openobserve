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
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import store from "@/test/unit/helpers/store";

// ─── Module mocks (hoisted) ──────────────────────────────────────────────────

vi.mock("@/services/service_streams", () => ({
  default: {
    getDimensionAnalytics: vi.fn().mockResolvedValue({
      data: {
        org_id: "test-org",
        total_dimensions: 0,
        by_cardinality: {},
        recommended_priority_dimensions: [],
        dimensions: [],
        available_groups: [],
        service_field_sources: [],
        generated_at: 0,
      },
    }),
    getIdentityConfig: vi.fn().mockResolvedValue({
      data: {
        sets: [],
        tracked_alias_ids: [],
      },
    }),
    saveIdentityConfig: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

vi.mock("@/utils/serviceStreamEnvs", () => ({
  ENV_SEGMENTS: {},
  groupEnvKey: vi.fn().mockReturnValue("all"),
}));

vi.mock("@/components/dashboards/panels/CustomChartRenderer.vue", () => ({
  default: {
    name: "CustomChartRenderer",
    template: '<div data-test="custom-chart-renderer" />',
    props: ["data"],
  },
}));

vi.mock("@/components/alerts/TagInput.vue", () => ({
  default: {
    name: "TagInput",
    template: '<div data-test="tag-input" />',
    props: ["modelValue", "placeholder", "label"],
    emits: ["update:modelValue"],
  },
}));

import ServiceIdentitySetup from "./ServiceIdentitySetup.vue";
import serviceStreamsService from "@/services/service_streams";

// ─── Test setup ──────────────────────────────────────────────────────────────

installQuasar();

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      settings: {
        correlation: {
          serviceNameNotDetected: "Service name not detected",
          serviceNameExpandedHelp: "Configure service name fields",
          serviceNameConfiguredNotSeen: "Configured but not seen",
          distinguishByLabel: "Distinguish By",
          distinguishByHelp: "Fields used to distinguish services",
          addField: "Add Field",
          addGroup: "Add Group",
          addGroupTooltip: "Add a new identity group",
          addFieldTooltip: "Add a field to this group",
          selectField: "Select field",
          saveIdentityConfig: "Save Configuration",
          customizeFieldMappings: "Customize Field Mappings",
          fieldMappingDialogHelp: "Map fields to service names",
          fieldMappingPlaceholder: "Enter field names",
          foundInLogs: "Found in Logs",
          foundInTraces: "Found in Traces",
          foundInMetrics: "Found in Metrics",
          autoSuggestedBanner: "Auto suggested",
          identityConfigSaved: "Configuration saved",
          identityConfigSaveFailed: "Failed to save configuration",
          identityConfigNoSets: "Configure at least one identity set",
          loadRecommendationsFailed: "Failed to load recommendations",
        },
      },
      common: {
        cancel: "Cancel",
        save: "Save",
      },
    },
  },
});

function mountComponent(props: Record<string, unknown> = {}) {
  return mount(ServiceIdentitySetup, {
    global: {
      plugins: [i18n, store],
      stubs: {
        "q-dialog": true,
        "q-menu": true,
        "q-tooltip": true,
      },
    },
    props: {
      orgIdentifier: "test-org",
      ...props,
    },
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ServiceIdentitySetup", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    it("should mount without errors", () => {
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("should call getDimensionAnalytics and getIdentityConfig on mount", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(serviceStreamsService.getDimensionAnalytics).toHaveBeenCalledWith(
        "test-org",
      );
      expect(serviceStreamsService.getIdentityConfig).toHaveBeenCalledWith(
        "test-org",
      );
    });
  });

  describe("loading state", () => {
    it("should hide main content while loading is true", () => {
      // Before flushPromises the component is in loading=true state; the v-else
      // block containing the main content should not be present yet.
      wrapper = mountComponent();
      // The save button and the add-distinguish-btn are both inside the v-else block
      expect(
        wrapper.find('[data-test="service-identity-save-btn"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="service-identity-add-distinguish-btn"]').exists(),
      ).toBe(false);
    });

    it("should show main content after data loads", async () => {
      wrapper = mountComponent();
      await flushPromises();
      // Once loading=false, the v-else block with main content is rendered.
      // The add-distinguish-btn is the empty-state btn visible when no fields are configured.
      expect(
        wrapper.find('[data-test="service-identity-add-distinguish-btn"]').exists(),
      ).toBe(true);
    });
  });

  describe("save button", () => {
    it("should render the save button when at least one identity set is configured", async () => {
      // The save button is inside the v-else block that renders when allConfiguredEnvs.length > 0
      vi.mocked(serviceStreamsService.getIdentityConfig).mockResolvedValueOnce({
        data: {
          sets: [
            { id: "k8s", label: "Kubernetes", distinguish_by: ["k8s-namespace"] },
          ],
          tracked_alias_ids: ["k8s-namespace"],
        },
      });
      wrapper = mountComponent();
      await flushPromises();
      expect(
        wrapper.find('[data-test="service-identity-save-btn"]').exists(),
      ).toBe(true);
    });

    it("should not render save button while data is still loading", () => {
      wrapper = mountComponent();
      // loading=true: v-else branch (which contains the save btn) is hidden
      expect(
        wrapper.find('[data-test="service-identity-save-btn"]').exists(),
      ).toBe(false);
    });
  });

  describe("warnings banner", () => {
    it("should not show the warnings banner when there are no warnings", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(
        wrapper.find('[data-test="service-identity-warnings-banner"]').exists(),
      ).toBe(false);
    });

    it("should show the warnings banner when warnings are present", async () => {
      wrapper = mountComponent();
      await flushPromises();

      // Directly set warnings via vm — no public API exists to reach this state
       
      (wrapper.vm as any).warnings = ["Service name field not configured"];
      await wrapper.vm.$nextTick();

      expect(
        wrapper.find('[data-test="service-identity-warnings-banner"]').exists(),
      ).toBe(true);
    });

    it("should display the warning text inside the banner", async () => {
      wrapper = mountComponent();
      await flushPromises();

      const warningText = "Ambiguous service names detected";
       
      (wrapper.vm as any).warnings = [warningText];
      await wrapper.vm.$nextTick();

      expect(
        wrapper.find('[data-test="service-identity-warnings-banner"]').text(),
      ).toContain(warningText);
    });
  });

  describe("emits", () => {
    it("should emit navigate-to-aliases with 'service' when the alias config link is clicked", async () => {
      wrapper = mountComponent();
      await flushPromises();

      // The "Customize Field Mappings" link is inside the expanded service name
      // section (v-if="serviceNameExpanded"). Expand it first by clicking the
      // collapsed header row, then find and click the link.
      const collapsedRow = wrapper.find(
        ".tw\\:cursor-pointer.hover\\:tw\\:opacity-80",
      );
      await collapsedRow.trigger("click");
      await wrapper.vm.$nextTick();

      const aliasLink = wrapper
        .findAll("a.config-link-btn")
        .find((el) => el.text().includes("Customize Field Mappings"));
      expect(aliasLink).toBeDefined();
      await aliasLink!.trigger("click");

      expect(wrapper.emitted("navigate-to-aliases")).toBeTruthy();
      expect(wrapper.emitted("navigate-to-aliases")![0]).toEqual(["service"]);
    });

    it("should emit navigate-to-services when the services link is clicked in the workload section", async () => {
      // Make availableGroups non-empty with dimension analytics so the workload detection section renders
      vi.mocked(serviceStreamsService.getDimensionAnalytics).mockResolvedValueOnce({
        data: {
          org_id: "test-org",
          total_dimensions: 1,
          by_cardinality: {
            "k8s-namespace": 5,
          },
          recommended_priority_dimensions: [],
          dimensions: [
            {
              dimension_name: "k8s-namespace",
              cardinality: 5,
              service_count: 3,
              cardinality_class: "Low",
              first_seen: 1640995200,
              last_updated: 1640995200,
              sample_values: {},
              value_children: {},
            },
          ],
          available_groups: [
            {
              group_id: "k8s-namespace",
              display: "K8s Namespace",
              stream_types: ["logs"],
              aliases: {},
              recommended: true,
            },
          ],
          service_field_sources: [],
          generated_at: 0,
        },
      });

      wrapper = mountComponent();
      await flushPromises();

      const servicesLink = wrapper.findAll("a.config-link-btn").find((el) =>
        el.text().includes("Go to Services"),
      );
      expect(servicesLink).toBeDefined();
      await servicesLink!.trigger("click");

      expect(wrapper.emitted("navigate-to-services")).toBeTruthy();
    });
  });
});

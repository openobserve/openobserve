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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { Notify } from "quasar";
import ServiceIdentityConfig from "./ServiceIdentityConfig.vue";

installQuasar({ plugins: { Notify } });

vi.mock("@/services/alerts", () => ({
  default: {
    getSemanticGroups: vi.fn(),
  },
}));

vi.mock("@/services/settings", () => ({
  default: {
    getSetting: vi.fn(),
    setOrgSetting: vi.fn(),
  },
}));

vi.mock("@/components/alerts/SemanticFieldGroupsConfig.vue", () => ({
  default: {
    name: "SemanticFieldGroupsConfig",
    template: '<div data-test="semantic-field-groups-config" />',
    props: ["modelValue", "orgId"],
    emits: ["update:modelValue"],
  },
}));

vi.mock("@/components/common/GroupHeader.vue", () => ({
  default: {
    name: "GroupHeader",
    template: '<div class="group-header"><slot /></div>',
    props: ["title", "showIcon"],
  },
}));

vi.mock("quasar", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useQuasar: () => ({ notify: vi.fn() }),
  };
});

import alertsService from "@/services/alerts";
import settingsService from "@/services/settings";

const mockSemanticGroups = [
  {
    id: "k8s-cluster",
    display: "K8s Cluster",
    group: "Kubernetes",
    fields: ["k8s.cluster.name"],
    normalize: false,
    is_stable: true,
    is_scope: true,
  },
  {
    id: "k8s-deployment",
    display: "K8s Deployment",
    group: "Kubernetes",
    fields: ["k8s.deployment.name"],
    normalize: false,
    is_stable: true,
    is_scope: false,
  },
  {
    id: "service",
    display: "Service Name",
    group: "Common",
    fields: ["service.name"],
    normalize: true,
    is_stable: false,
    is_scope: false,
  },
  {
    id: "service-fqn",
    display: "Service FQN",
    group: "Internal",
    fields: ["service.fqn"],
    normalize: false,
    is_stable: true,
    is_scope: false,
  },
];

const defaultFqnPriority = ["k8s-cluster", "k8s-deployment"];

const mockStore = createStore({
  state: {
    selectedOrganization: { identifier: "test-org" },
    theme: "light",
    zoConfig: {
      fqn_priority_dimensions: defaultFqnPriority,
    },
  },
});

const mockI18n = createI18n({
  locale: "en",
  messages: {
    en: {
      settings: {
        correlation: {
          serviceIdentityTitle: "Service Identity Configuration",
          serviceIdentityDescription: "Configure how services are identified",
          howItWorksTitle: "How it works",
          serviceIdentityLabel: "Service Identity",
          howItWorksDescription: "...",
          compoundFqnLabel: "Compound FQN",
          compoundFqnDescription: "...",
          exampleLabel: "Example",
          exampleText: "Dimensions {dim1} and {dim2} produce {value}",
          fqnPrioritySaved: "FQN priority saved",
          configSaveFailed: "Failed to save",
          fallbackGroup: "Fallback",
          otherGroup: "Other",
          emptyIdError: " has empty ID",
        },
      },
      common: {
        nameRequired: "Name is required",
      },
    },
  },
});

const globalStubs = {
  "q-spinner-hourglass": true,
  "q-icon": { template: "<span />", props: ["name", "size", "color"] },
  "q-btn": { template: '<button :data-test="$attrs[\'data-test\']" @click="$emit(\'click\')"><slot /></button>', props: ["label", "flat", "dense", "loading", "disable"], emits: ["click"] },
  "q-expansion-item": { template: '<div class="expansion-item"><slot /><slot name="header" /></div>', props: ["label", "icon", "dense", "class", "modelValue"], emits: ["update:modelValue"] },
  "q-chip": { template: "<span class='q-chip'><slot /></span>", props: ["dense", "size", "color", "textColor", "removable"], emits: ["remove"] },
  "q-badge": { template: "<span><slot /></span>" },
  "q-input": { template: '<input />', props: ["modelValue", "dense", "filled", "clearable", "placeholder"] },
  "q-item": { template: "<div class='q-item' @click=\"$emit('click')\"><slot /></div>", emits: ["click"] },
  "q-item-section": { template: "<div><slot /></div>", props: ["side", "avatar"] },
  "q-item-label": { template: "<div><slot /></div>", props: ["caption"] },
  "q-list": { template: "<div><slot /></div>", props: ["dense", "bordered"] },
  "q-separator": true,
  "q-tooltip": { template: "<span><slot /></span>" },
  "q-card": { template: "<div><slot /></div>" },
  "q-card-section": { template: "<div><slot /></div>" },
  "q-tab-panels": { template: "<div><slot /></div>", props: ["modelValue"] },
  "q-tab-panel": { template: "<div><slot /></div>", props: ["name"] },
  "q-tabs": { template: "<div><slot /></div>", props: ["modelValue"], emits: ["update:modelValue"] },
  "q-tab": { template: "<div />", props: ["name", "label"] },
  "i18n-t": { template: "<span><slot /></span>", props: ["keypath", "tag"] },
};

function mountComponent(propsOverrides = {}) {
  return mount(ServiceIdentityConfig, {
    props: {
      orgId: "test-org",
      ...propsOverrides,
    },
    global: {
      plugins: [mockI18n],
      provide: { store: mockStore },
      stubs: globalStubs,
    },
  });
}

describe("ServiceIdentityConfig", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.mocked(settingsService.getSetting).mockRejectedValue(new Error("not found"));
    vi.mocked(alertsService.getSemanticGroups).mockResolvedValue({
      data: mockSemanticGroups,
    } as any);
    vi.mocked(settingsService.setOrgSetting).mockResolvedValue({ data: {} } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    it("should render without errors", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should call getSetting for fqn_priority_dimensions on mount", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(settingsService.getSetting).toHaveBeenCalledWith("test-org", "fqn_priority_dimensions");
    });

    it("should call getSetting for semantic_field_groups on mount", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(settingsService.getSetting).toHaveBeenCalledWith("test-org", "semantic_field_groups");
    });

    it("should load semantic groups from alertsService when settings not found", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(alertsService.getSemanticGroups).toHaveBeenCalledWith("test-org");
    });

    it("should set loading to false after config loads", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.loading).toBe(false);
    });

    it("should use backend default fqn priority when settings not found", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.localFqnPriority).toEqual(defaultFqnPriority);
    });
  });

  describe("settings v2 priority loading", () => {
    it("should use fqn priority from settings v2 when available", async () => {
      vi.mocked(settingsService.getSetting).mockImplementation(
        (_orgId: string, key: string) => {
          if (key === "fqn_priority_dimensions") {
            return Promise.resolve({
              data: { setting_value: ["service", "k8s-cluster"] },
            } as any);
          }
          return Promise.reject(new Error("not found"));
        },
      );
      wrapper = mountComponent();
      await flushPromises();
      // sortFqnPriorityByScopeFirst puts scope dims (k8s-cluster) before workload dims (service)
      expect(wrapper.vm.localFqnPriority).toEqual(["k8s-cluster", "service"]);
    });

    it("should use semantic groups from settings v2 when available", async () => {
      const customGroups = [mockSemanticGroups[0], mockSemanticGroups[1]];
      vi.mocked(settingsService.getSetting).mockImplementation(
        (_orgId: string, key: string) => {
          if (key === "semantic_field_groups") {
            return Promise.resolve({
              data: { setting_value: customGroups },
            } as any);
          }
          return Promise.reject(new Error("not found"));
        },
      );
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.localSemanticGroups).toHaveLength(2);
      // alertsService should not be called since we got from settings
      expect(alertsService.getSemanticGroups).not.toHaveBeenCalled();
    });
  });

  describe("availableSemanticGroups computed", () => {
    it("should exclude reserved group IDs (service-fqn)", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const available = wrapper.vm.availableSemanticGroups;
      expect(available.find((g: any) => g.value === "service-fqn")).toBeUndefined();
    });

    it("should exclude dimensions already in localFqnPriority", async () => {
      wrapper = mountComponent();
      await flushPromises();
      // k8s-cluster and k8s-deployment are in defaultFqnPriority
      const available = wrapper.vm.availableSemanticGroups;
      expect(available.find((g: any) => g.value === "k8s-cluster")).toBeUndefined();
      expect(available.find((g: any) => g.value === "k8s-deployment")).toBeUndefined();
    });

    it("should include dimensions not in priority list", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const available = wrapper.vm.availableSemanticGroups;
      // "service" is in mockSemanticGroups but not in defaultFqnPriority
      expect(available.find((g: any) => g.value === "service")).toBeTruthy();
    });
  });

  describe("filteredPriorityDimensions computed", () => {
    it("should return all when no search query", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.prioritySearchQuery = "";
      expect(wrapper.vm.filteredPriorityDimensions).toHaveLength(
        wrapper.vm.localFqnPriority.length,
      );
    });

    it("should filter by search query", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.prioritySearchQuery = "cluster";
      const filtered = wrapper.vm.filteredPriorityDimensions;
      expect(filtered.length).toBeLessThanOrEqual(wrapper.vm.localFqnPriority.length);
    });
  });

  describe("filteredAvailableGroups computed", () => {
    it("should return all available groups when no search", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.availableSearchQuery = "";
      expect(wrapper.vm.filteredAvailableGroups).toHaveLength(
        wrapper.vm.availableSemanticGroups.length,
      );
    });

    it("should filter available groups by search query", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.availableSearchQuery = "service";
      const filtered = wrapper.vm.filteredAvailableGroups;
      expect(
        filtered.every(
          (g: any) =>
            g.label.toLowerCase().includes("service") ||
            g.value.toLowerCase().includes("service"),
        ),
      ).toBe(true);
    });
  });

  describe("isDimensionScope", () => {
    it("should return true for scope dimensions", async () => {
      wrapper = mountComponent();
      await flushPromises();
      // k8s-cluster has is_scope: true in mockSemanticGroups
      expect(wrapper.vm.isDimensionScope("k8s-cluster")).toBe(true);
    });

    it("should return false for non-scope dimensions", async () => {
      wrapper = mountComponent();
      await flushPromises();
      // k8s-deployment has is_scope: false
      expect(wrapper.vm.isDimensionScope("k8s-deployment")).toBe(false);
    });

    it("should return false for unknown dimension IDs", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.isDimensionScope("unknown-dim")).toBe(false);
    });
  });

  describe("togglePrioritySelection", () => {
    it("should add dimension to selected when not selected", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedPriorityDimensions = [];
      wrapper.vm.togglePrioritySelection("k8s-cluster");
      expect(wrapper.vm.selectedPriorityDimensions).toContain("k8s-cluster");
    });

    it("should remove dimension when already selected", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedPriorityDimensions = ["k8s-cluster"];
      wrapper.vm.togglePrioritySelection("k8s-cluster");
      expect(wrapper.vm.selectedPriorityDimensions).not.toContain("k8s-cluster");
    });
  });

  describe("saveFqnPriority", () => {
    it("should call setOrgSetting with current localFqnPriority", async () => {
      wrapper = mountComponent();
      await flushPromises();
      await wrapper.vm.saveFqnPriority();
      expect(settingsService.setOrgSetting).toHaveBeenCalledWith(
        "test-org",
        "fqn_priority_dimensions",
        wrapper.vm.localFqnPriority,
        "correlation",
        expect.any(String),
      );
    });

    it("should emit saved event on success", async () => {
      wrapper = mountComponent();
      await flushPromises();
      await wrapper.vm.saveFqnPriority();
      expect(wrapper.emitted("saved")).toBeTruthy();
    });

    it("should set savingFqn to false after saving", async () => {
      wrapper = mountComponent();
      await flushPromises();
      await wrapper.vm.saveFqnPriority();
      expect(wrapper.vm.savingFqn).toBe(false);
    });

    it("should handle save error without crashing", async () => {
      vi.mocked(settingsService.setOrgSetting).mockRejectedValueOnce(
        new Error("Save failed"),
      );
      wrapper = mountComponent();
      await flushPromises();
      await expect(wrapper.vm.saveFqnPriority()).resolves.not.toThrow();
      expect(wrapper.vm.savingFqn).toBe(false);
    });
  });

  describe("fqnFormula computed", () => {
    it("should produce scopeDims and workloadDims from localFqnPriority", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const formula = wrapper.vm.fqnFormula;
      expect(formula).toHaveProperty("scopeDims");
      expect(formula).toHaveProperty("workloadDims");
      expect(formula).toHaveProperty("envPatterns");
    });

    it("should categorize k8s-cluster as scope dimension", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const formula = wrapper.vm.fqnFormula;
      expect(formula.scopeDims).toContain("k8s-cluster");
    });

    it("should categorize k8s-deployment as workload dimension", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const formula = wrapper.vm.fqnFormula;
      expect(formula.workloadDims).toContain("k8s-deployment");
    });
  });

  describe("initial state", () => {
    it("should initialize fqnSectionExpanded to true", async () => {
      wrapper = mountComponent();
      expect(wrapper.vm.fqnSectionExpanded).toBe(true);
    });

    it("should initialize semanticSectionExpanded to true", async () => {
      wrapper = mountComponent();
      expect(wrapper.vm.semanticSectionExpanded).toBe(true);
    });

    it("should initialize with empty search queries", async () => {
      wrapper = mountComponent();
      expect(wrapper.vm.prioritySearchQuery).toBe("");
      expect(wrapper.vm.availableSearchQuery).toBe("");
    });

    it("should initialize with empty selected dimensions", async () => {
      wrapper = mountComponent();
      expect(wrapper.vm.selectedAvailableDimensions).toHaveLength(0);
      expect(wrapper.vm.selectedPriorityDimensions).toHaveLength(0);
    });
  });
});

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
import DiscoveredServices from "./DiscoveredServices.vue";

installQuasar();

vi.mock("@/services/service_streams", () => ({
  default: {
    getGroupedServices: vi.fn(),
  },
}));

vi.mock("@/components/common/GroupHeader.vue", () => ({
  default: {
    name: "GroupHeader",
    template: '<div class="group-header"><slot /></div>',
    props: ["title", "showIcon"],
  },
}));

import serviceStreamsService from "@/services/service_streams";

const mockGroupedServicesResponse = {
  groups: [
    {
      fqn: "prod/api-server",
      services: [
        {
          service_name: "api-server",
          derived_from: "k8s-deployment",
          dimensions: {},
          stream_names: { logs: ["api-logs"], traces: ["api-traces"], metrics: ["api-metrics"] },
        },
      ],
      stream_summary: {
        has_logs: true,
        has_traces: true,
        has_metrics: true,
        has_full_correlation: true,
        logs_count: 1,
        traces_count: 1,
        metrics_count: 1,
        log_streams: ["api-logs"],
        trace_streams: ["api-traces"],
        metric_streams: ["api-metrics"],
      },
    },
    {
      fqn: "prod/worker",
      services: [
        {
          service_name: "worker",
          derived_from: "k8s-statefulset",
          dimensions: {},
          stream_names: { logs: ["worker-logs"], traces: [], metrics: [] },
        },
      ],
      stream_summary: {
        has_logs: true,
        has_traces: true,
        has_metrics: false,
        has_full_correlation: false,
        logs_count: 1,
        traces_count: 1,
        metrics_count: 0,
        log_streams: ["worker-logs"],
        trace_streams: ["worker-traces"],
        metric_streams: [],
      },
    },
  ],
  total_fqns: 2,
  total_services: 2,
};

const mockEmptyResponse = {
  groups: [],
  total_fqns: 0,
  total_services: 0,
};

const mockStore = createStore({
  state: {
    selectedOrganization: { identifier: "test-org" },
    theme: "light",
  },
});

const mockI18n = createI18n({
  locale: "en",
  messages: {
    en: {
      settings: {
        correlation: {
          discoveredServicesTitle: "Discovered Services",
          discoveredServicesDescription: "Services discovered from telemetry",
          retry: "Retry",
          noServicesYet: "No services yet",
          noServicesDescription: "Start sending telemetry data",
          fqns: "FQNs",
          services: "Services",
          fullyCorrelated: "Fully Correlated",
          suggestions: "Suggestions",
          clickToViewSuggestions: "Click to view",
          byFqn: "By FQN",
          byService: "By Service",
          byStream: "By Stream",
          searchFqnOrService: "Search FQN or service...",
          searchServiceName: "Search service name...",
          searchStreamName: "Search stream name...",
          allServices: "All Services",
          missingTelemetry: "Missing Telemetry",
          fqn: "FQN",
          correlationKey: "Correlation Key",
          telemetryCoverage: "Telemetry Coverage",
          serviceName: "Service Name",
          fqnSource: "FQN Source",
          deployment: "Deployment",
          statefulSet: "StatefulSet",
          howItWorksTitle: "How it works",
        },
      },
      common: {
        refresh: "Refresh",
        search: "Search...",
      },
    },
  },
});

const globalStubs = {
  "q-spinner-hourglass": true,
  "q-icon": { template: "<span />", props: ["name", "size", "color"] },
  "q-btn": { template: '<button :data-test="$attrs[\'data-test\']" @click="$emit(\'click\')"><slot /></button>', props: ["label", "flat", "dense", "color", "loading", "icon"], emits: ["click"] },
  "q-btn-toggle": { template: "<div />", props: ["modelValue", "options", "dense", "unelevated"] },
  "q-input": { template: '<input :placeholder="placeholder" />', props: ["modelValue", "dense", "filled", "placeholder", "clearable"] },
  "q-select": { template: "<select />", props: ["modelValue", "dense", "filled", "options", "emitValue", "mapOptions"] },
  "q-table": { template: '<div class="q-table"><slot name="no-data" /></div>', props: ["rows", "columns", "pagination", "filter", "loading", "dense"] },
  "q-tooltip": { template: "<span><slot /></span>" },
  "q-chip": { template: "<span class='q-chip'><slot /></span>", props: ["dense", "size", "color", "textColor"] },
  "q-badge": { template: "<span><slot /></span>", props: ["color"] },
  "q-dialog": { template: "<div><slot /></div>", props: ["modelValue"] },
  "q-card": { template: "<div><slot /></div>" },
  "q-card-section": { template: "<div><slot /></div>" },
  "q-card-actions": { template: "<div><slot /></div>" },
  "q-list": { template: "<div><slot /></div>" },
  "q-item": { template: "<div><slot /></div>" },
  "q-item-section": { template: "<div><slot /></div>" },
  "q-item-label": { template: "<div><slot /></div>" },
  "q-separator": true,
  "q-expansion-item": { template: "<div><slot /></div>", props: ["label", "icon", "dense"] },
  "i18n-t": { template: "<span><slot /></span>", props: ["keypath", "tag"] },
};

function mountComponent() {
  return mount(DiscoveredServices, {
    global: {
      plugins: [mockI18n],
      provide: { store: mockStore },
      stubs: globalStubs,
    },
  });
}

describe("DiscoveredServices", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.mocked(serviceStreamsService.getGroupedServices).mockResolvedValue({
      data: mockGroupedServicesResponse,
    } as any);
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

    it("should call getGroupedServices on mount", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(serviceStreamsService.getGroupedServices).toHaveBeenCalledWith("test-org");
    });

    it("should show loading spinner initially", () => {
      wrapper = mountComponent();
      // loading starts as true
      expect(wrapper.vm.loading).toBe(true);
    });

    it("should hide loading after data loads", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.loading).toBe(false);
    });
  });

  describe("loaded state with services", () => {
    it("should set groupedServices from response", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.groupedServices.total_fqns).toBe(2);
      expect(wrapper.vm.groupedServices.total_services).toBe(2);
      expect(wrapper.vm.groupedServices.groups).toHaveLength(2);
    });

    it("should show refresh button", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find('[data-test="refresh-discovered-services-btn"]').exists()).toBe(true);
    });
  });

  describe("empty state", () => {
    it("should show empty state when no services found", async () => {
      vi.mocked(serviceStreamsService.getGroupedServices).mockResolvedValue({
        data: mockEmptyResponse,
      } as any);
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.text()).toContain("No services yet");
    });

    it("should show refresh button in empty state", async () => {
      vi.mocked(serviceStreamsService.getGroupedServices).mockResolvedValue({
        data: mockEmptyResponse,
      } as any);
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find('[data-test="refresh-discovered-services-btn"]').exists()).toBe(true);
    });
  });

  describe("error state", () => {
    it("should set error message on API failure", async () => {
      vi.mocked(serviceStreamsService.getGroupedServices).mockRejectedValue(
        new Error("Network error"),
      );
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.error).toBe("Network error");
    });

    it("should show retry button in error state", async () => {
      vi.mocked(serviceStreamsService.getGroupedServices).mockRejectedValue(
        new Error("Network error"),
      );
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find('[data-test="retry-discovered-services-btn"]').exists()).toBe(true);
    });

    it("should clear error on retry", async () => {
      vi.mocked(serviceStreamsService.getGroupedServices).mockRejectedValueOnce(
        new Error("fail"),
      );
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.error).toBeTruthy();

      // Now succeed
      vi.mocked(serviceStreamsService.getGroupedServices).mockResolvedValueOnce({
        data: mockGroupedServicesResponse,
      } as any);
      await wrapper.vm.loadServices();
      await flushPromises();
      expect(wrapper.vm.error).toBeNull();
    });
  });

  describe("fullCorrelationCount computed", () => {
    it("should count fully correlated services", async () => {
      wrapper = mountComponent();
      await flushPromises();
      // 1 of 2 groups has has_full_correlation=true
      expect(wrapper.vm.fullCorrelationCount).toBe(1);
    });

    it("should return 0 when no groups loaded", () => {
      wrapper = mountComponent();
      // Before data loads, groups = []
      expect(wrapper.vm.fullCorrelationCount).toBe(0);
    });
  });

  describe("correlationSuggestions computed", () => {
    it("should return suggestions for partially correlated groups", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const suggestions = wrapper.vm.correlationSuggestions;
      // worker group has logs+traces but is missing metrics (typeCount=2, not fully correlated)
      expect(suggestions.length).toBeGreaterThan(0);
      const workerSuggestion = suggestions.find((s: any) => s.fqn === "prod/worker");
      expect(workerSuggestion).toBeTruthy();
    });

    it("should return empty array when all are fully correlated", async () => {
      vi.mocked(serviceStreamsService.getGroupedServices).mockResolvedValue({
        data: {
          groups: [mockGroupedServicesResponse.groups[0]], // only fully correlated
          total_fqns: 1,
          total_services: 1,
        },
      } as any);
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.correlationSuggestions).toHaveLength(0);
    });
  });

  describe("viewMode", () => {
    it("should default to fqn view mode", () => {
      wrapper = mountComponent();
      expect(wrapper.vm.viewMode).toBe("fqn");
    });

    it("should allow switching to service view mode", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.viewMode = "service";
      expect(wrapper.vm.viewMode).toBe("service");
    });

    it("should allow switching to stream view mode", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.viewMode = "stream";
      expect(wrapper.vm.viewMode).toBe("stream");
    });
  });

  describe("filteredGroups computed", () => {
    it("should return all groups when filterStatus=all and searchQuery is empty", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.filterStatus = "all";
      wrapper.vm.searchQuery = "";
      expect(wrapper.vm.filteredGroups).toHaveLength(2);
    });

    it("should return only fully correlated when filterStatus=full", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.filterStatus = "full";
      wrapper.vm.searchQuery = "";
      const filtered = wrapper.vm.filteredGroups;
      expect(filtered.every((g: any) => g.stream_summary.has_full_correlation)).toBe(true);
    });

    it("should return only partial when filterStatus=partial", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.filterStatus = "partial";
      wrapper.vm.searchQuery = "";
      const filtered = wrapper.vm.filteredGroups;
      expect(filtered.every((g: any) => !g.stream_summary.has_full_correlation)).toBe(true);
    });

    it("should filter by search query on fqn", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.filterStatus = "all";
      wrapper.vm.searchQuery = "api-server";
      const filtered = wrapper.vm.filteredGroups;
      expect(filtered).toHaveLength(1);
      expect(filtered[0].fqn).toContain("api-server");
    });
  });

  describe("getGroupHeaderClass", () => {
    it("should return empty string for fully correlated group", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const fullyCorrelatedGroup = wrapper.vm.groupedServices.groups[0];
      expect(wrapper.vm.getGroupHeaderClass(fullyCorrelatedGroup)).toBe("");
    });

    it("should return bg-warning-1 for partial group", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const partialGroup = wrapper.vm.groupedServices.groups[1];
      expect(wrapper.vm.getGroupHeaderClass(partialGroup)).toBe("bg-warning-1");
    });
  });

  describe("getDerivedFromColor", () => {
    it("should return blue for k8s-deployment", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.getDerivedFromColor("k8s-deployment")).toBe("blue");
    });

    it("should return purple for k8s-statefulset", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.getDerivedFromColor("k8s-statefulset")).toBe("purple");
    });

    it("should return teal for k8s-daemonset", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.getDerivedFromColor("k8s-daemonset")).toBe("teal");
    });

    it("should return orange for aws-ecs-task", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.getDerivedFromColor("aws-ecs-task")).toBe("orange");
    });

    it("should return grey for unknown sources", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.getDerivedFromColor("unknown-source")).toBe("grey");
    });
  });

  describe("missing org error", () => {
    it("should set error when no org is selected", async () => {
      const storeNoOrg = createStore({
        state: { selectedOrganization: null, theme: "light" },
      });
      wrapper = mount(DiscoveredServices, {
        global: {
          plugins: [mockI18n],
          provide: { store: storeNoOrg },
          stubs: globalStubs,
        },
      });
      await flushPromises();
      expect(wrapper.vm.error).toBeTruthy();
    });
  });

  describe("loadServices on refresh", () => {
    it("should re-fetch services when loadServices is called", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const callCount = vi.mocked(serviceStreamsService.getGroupedServices).mock.calls.length;

      await wrapper.vm.loadServices();
      await flushPromises();

      expect(vi.mocked(serviceStreamsService.getGroupedServices).mock.calls.length).toBe(callCount + 1);
    });
  });
});

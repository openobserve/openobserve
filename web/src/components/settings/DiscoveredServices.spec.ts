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
    getServicesList: vi.fn(),
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

const mockServicesResponse = [
  {
    id: "1",
    org_id: "test-org",
    service_name: "api-server",
    set_id: "api-server-set",
    disambiguation: { "k8s-cluster": "prod", "k8s-deployment": "api-server" },
    all_dimensions: {},
    logs_streams: ["api-logs"],
    traces_streams: ["api-traces"],
    metrics_streams: ["api-metrics"],
    field_name_mapping: {},
    last_seen: 1000000,
  },
  {
    id: "2",
    org_id: "test-org",
    service_name: "worker",
    set_id: "worker-set",
    disambiguation: { "k8s-cluster": "prod", "k8s-statefulset": "worker" },
    all_dimensions: {},
    logs_streams: ["worker-logs"],
    traces_streams: [],
    metrics_streams: [],
    field_name_mapping: {},
    last_seen: 2000000,
  },
];

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
          services: "Services",
          searchServiceName: "Search service name...",
          allServices: "All Services",
          missingTelemetry: "Missing Telemetry",
          serviceName: "Service Name",
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
    vi.mocked(serviceStreamsService.getServicesList).mockResolvedValue({
      data: mockServicesResponse,
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

    it("should call getServicesList on mount", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(serviceStreamsService.getServicesList).toHaveBeenCalledWith("test-org");
    });

    it("should show loading spinner initially", () => {
      wrapper = mountComponent();
      expect(wrapper.vm.loading).toBe(true);
    });

    it("should hide loading after data loads", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.loading).toBe(false);
    });
  });

  describe("loaded state with services", () => {
    it("should populate services from response", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.services).toHaveLength(2);
    });

    it("should group services by service_name", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.serviceGroups).toHaveLength(2);
      const names = wrapper.vm.serviceGroups.map((g: any) => g.service_name);
      expect(names).toContain("api-server");
      expect(names).toContain("worker");
    });

    it("should show refresh button", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find('[data-test="refresh-discovered-services-btn"]').exists()).toBe(true);
    });
  });

  describe("empty state", () => {
    it("should show empty state when no services found", async () => {
      vi.mocked(serviceStreamsService.getServicesList).mockResolvedValue({
        data: [],
      } as any);
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.text()).toContain("No services yet");
    });

    it("should show refresh button in empty state", async () => {
      vi.mocked(serviceStreamsService.getServicesList).mockResolvedValue({
        data: [],
      } as any);
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find('[data-test="refresh-discovered-services-btn"]').exists()).toBe(true);
    });
  });

  describe("error state", () => {
    it("should set error message on API failure", async () => {
      vi.mocked(serviceStreamsService.getServicesList).mockRejectedValue(
        new Error("Network error"),
      );
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.error).toBe("Network error");
    });

    it("should show retry button in error state", async () => {
      vi.mocked(serviceStreamsService.getServicesList).mockRejectedValue(
        new Error("Network error"),
      );
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find('[data-test="retry-discovered-services-btn"]').exists()).toBe(true);
    });

    it("should clear error on retry", async () => {
      vi.mocked(serviceStreamsService.getServicesList).mockRejectedValueOnce(
        new Error("fail"),
      );
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.error).toBeTruthy();

      vi.mocked(serviceStreamsService.getServicesList).mockResolvedValueOnce({
        data: mockServicesResponse,
      } as any);
      await wrapper.vm.loadServices();
      await flushPromises();
      expect(wrapper.vm.error).toBeNull();
    });
  });

  describe("filteredGroups computed", () => {
    it("should return all groups when searchQuery is empty", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.searchQuery = "";
      expect(wrapper.vm.filteredGroups).toHaveLength(2);
    });

    it("should filter by search query on service_name", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.searchQuery = "api-server";
      const filtered = wrapper.vm.filteredGroups;
      expect(filtered).toHaveLength(1);
      expect(filtered[0].service_name).toContain("api-server");
    });

    it("should filter by dimension key/value", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.filterKey = "k8s-statefulset";
      wrapper.vm.filterValue = "worker";
      const filtered = wrapper.vm.filteredGroups;
      expect(filtered).toHaveLength(1);
      expect(filtered[0].service_name).toBe("worker");
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
      const callCount = vi.mocked(serviceStreamsService.getServicesList).mock.calls.length;

      await wrapper.vm.loadServices();
      await flushPromises();

      expect(vi.mocked(serviceStreamsService.getServicesList).mock.calls.length).toBe(callCount + 1);
    });
  });
});

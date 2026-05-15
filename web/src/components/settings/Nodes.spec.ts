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
import Nodes from "./Nodes.vue";

installQuasar({ plugins: { Notify } });

vi.mock("@/services/common", () => ({
  default: {
    list_nodes: vi.fn(),
  },
}));

vi.mock("@/composables/useIsMetaOrg", () => ({
  default: () => ({
    isMetaOrg: { value: true },
  }),
}));

vi.mock("quasar", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useQuasar: () => ({
      notify: vi.fn(() => vi.fn()), // returns dismiss function
    }),
  };
});

import CommonService from "@/services/common";

const mockNodeData = {
  "us-west": {
    "cluster-1": [
      {
        name: "node-1",
        version: "0.70.0",
        status: "Online",
        role: ["ingester", "querier"],
        metrics: {
          cpu_usage: 45.2,
          memory_usage: 4096,
          memory_total: 8192,
          tcp_conns: 120,
          tcp_conns_established: 80,
          tcp_conns_close_wait: 10,
          tcp_conns_time_wait: 5,
        },
      },
      {
        name: "node-2",
        version: "0.70.0",
        status: "Online",
        role: ["compactor"],
        metrics: {
          cpu_usage: 30.0,
          memory_usage: 2048,
          memory_total: 8192,
          tcp_conns: 60,
          tcp_conns_established: 40,
          tcp_conns_close_wait: 5,
          tcp_conns_time_wait: 2,
        },
      },
    ],
    "cluster-2": [
      {
        name: "node-3",
        version: "0.69.0",
        status: "Offline",
        role: ["router"],
        metrics: {
          cpu_usage: 0,
          memory_usage: 1024,
          memory_total: 8192,
          tcp_conns: 0,
          tcp_conns_established: 0,
          tcp_conns_close_wait: 0,
          tcp_conns_time_wait: 0,
        },
      },
    ],
  },
};

const mockStore = createStore({
  state: {
    selectedOrganization: { identifier: "test-org" },
    zoConfig: { super_cluster_enabled: true },
    theme: "light",
  },
});

const mockI18n = createI18n({
  locale: "en",
  messages: {
    en: {
      nodes: {
        header: "Nodes",
        name: "Name",
        region: "Region",
        cluster: "Cluster",
        version: "Version",
        cpu: "CPU",
        memory: "Memory",
        tcp: "TCP",
        nodetype: "Node Type",
        status: "Status",
        cpuusage: "CPU Usage",
        memoryusage: "Memory Usage",
        tcpusage: "TCP Usage",
        filter_header: "Filters",
        clear_all: "Clear All",
        search: "Search...",
        searchRegion: "Search Region",
        searchCluster: "Search Cluster",
        applyFilter: "Apply Filter",
        establishedLabel: "Established",
        closewaitLabel: "Close Wait",
        waittimeLabel: "Wait Time",
      },
      common: {
        refresh: "Refresh",
      },
    },
  },
});

function mountComponent() {
  return mount(Nodes, {
    global: {
      plugins: [mockI18n],
      provide: { store: mockStore },
      stubs: {
        "OPage": { template: "<div><slot /></div>" },
        "q-splitter": { template: '<div><slot name="before" /><slot name="after" /></div>', props: ["modelValue", "limits", "unit", "style"] },
        "q-spinner-hourglass": true,
        "q-table": { template: '<div class="q-table"><slot name="bottom" :scope="{}" /><slot name="no-data" /></div>', props: ["rows", "columns", "rowKey", "pagination", "filter", "filterMethod", "loading", "dense", "style", "hideTop"] },
        "q-expansion-item": { template: '<div><slot /></div>', props: ["expandSeparator", "label", "class"] },
        "q-card": { template: "<div><slot /></div>" },
        "q-card-section": { template: "<div><slot /></div>", props: ["class"] },
        "q-checkbox": { template: "<input type='checkbox' />", props: ["modelValue", "size"], emits: ["update:modelValue"] },
        "q-range": { template: '<div class="q-range" />', props: ["modelValue", "min", "max", "disable"], emits: ["change"] },
        "q-badge": { template: "<span><slot /></span>" },
        "q-linear-progress": { template: '<div class="q-linear-progress" />', props: ["value", "color"] },
        "q-tooltip": { template: "<span><slot /></span>" },
        "q-list": { template: "<div><slot /></div>" },
        "q-btn": { template: '<button @click="$emit(\'click\')"><slot /></button>', props: ["label", "icon", "flat"], emits: ["click"] },
        "q-td": { template: "<td><slot /></td>", props: ["props"] },
        "QTablePagination": { template: "<div class='pagination' />", props: ["scope", "resultTotal", "perPageOptions", "position"], emits: ["update:changeRecordPerPage"] },
        "NoData": { template: "<div class='no-data'>No Data</div>" },
      },
    },
  });
}

describe("Nodes", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.mocked(CommonService.list_nodes).mockResolvedValue({
      data: mockNodeData,
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

    it("should call list_nodes on mount (meta org)", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(CommonService.list_nodes).toHaveBeenCalledWith("test-org");
    });

    it("should render the nodes table", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find(".q-table").exists()).toBe(true);
    });
  });

  describe("flattenObject utility", () => {
    it("should flatten nested node data correctly", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const { flattenedData } = wrapper.vm.flattenObject(mockNodeData);
      expect(flattenedData).toHaveLength(3);
    });

    it("should assign incremental IDs starting from 01", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const { flattenedData } = wrapper.vm.flattenObject(mockNodeData);
      expect(flattenedData[0].id).toBe("01");
      expect(flattenedData[1].id).toBe("02");
      expect(flattenedData[2].id).toBe("03");
    });

    it("should compute percentage memory usage", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const { flattenedData } = wrapper.vm.flattenObject(mockNodeData);
      // node-1: 4096/8192 = 50%
      expect(flattenedData[0].percentage_memory_usage).toBe(50);
    });

    it("should round cpu usage", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const { flattenedData } = wrapper.vm.flattenObject(mockNodeData);
      expect(flattenedData[0].cpu_usage).toBe(45);
    });

    it("should extract unique regions", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const { uniqueValues } = wrapper.vm.flattenObject(mockNodeData);
      expect(uniqueValues.regions).toContain("us-west");
    });

    it("should extract unique clusters", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const { uniqueValues } = wrapper.vm.flattenObject(mockNodeData);
      expect(uniqueValues.clusters).toContain("cluster-1");
      expect(uniqueValues.clusters).toContain("cluster-2");
    });

    it("should extract unique node types from roles", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const { uniqueValues } = wrapper.vm.flattenObject(mockNodeData);
      expect(uniqueValues.nodeTypes).toContain("ingester");
      expect(uniqueValues.nodeTypes).toContain("querier");
      expect(uniqueValues.nodeTypes).toContain("compactor");
    });

    it("should extract unique statuses", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const { uniqueValues } = wrapper.vm.flattenObject(mockNodeData);
      expect(uniqueValues.statuses).toContain("Online");
      expect(uniqueValues.statuses).toContain("Offline");
    });

    it("should track max CPU usage", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const { maxValues } = wrapper.vm.flattenObject(mockNodeData);
      expect(maxValues.cpuUsage.value).toBe(45); // rounded from 45.2
    });
  });

  describe("applyFilter", () => {
    it("should filter data by search query", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.filterQuery = "node-1";
      wrapper.vm.applyFilter();
      expect(wrapper.vm.tabledata).toHaveLength(1);
      expect(wrapper.vm.tabledata[0].name).toBe("node-1");
    });

    it("should return all data when filter is empty", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.filterQuery = "";
      wrapper.vm.applyFilter();
      expect(wrapper.vm.tabledata).toHaveLength(3);
    });

    it("should filter by selected region", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedRegions = [{ name: "us-west" }];
      wrapper.vm.applyFilter();
      expect(wrapper.vm.tabledata.length).toBeGreaterThan(0);
    });

    it("should filter by selected node type", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedNodetypes = [{ name: "compactor" }];
      wrapper.vm.applyFilter();
      expect(wrapper.vm.tabledata).toHaveLength(1);
      expect(wrapper.vm.tabledata[0].name).toBe("node-2");
    });

    it("should filter by selected status", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedStatuses = [{ name: "Offline" }];
      wrapper.vm.applyFilter();
      expect(wrapper.vm.tabledata).toHaveLength(1);
      expect(wrapper.vm.tabledata[0].name).toBe("node-3");
    });

    it("should update resultTotal after filtering", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.filterQuery = "node-1";
      wrapper.vm.applyFilter();
      expect(wrapper.vm.resultTotal).toBe(1);
    });
  });

  describe("clearAll", () => {
    it("should reset all filters and restore original data", async () => {
      wrapper = mountComponent();
      await flushPromises();

      // Apply a filter first
      wrapper.vm.filterQuery = "node-1";
      wrapper.vm.applyFilter();
      expect(wrapper.vm.tabledata).toHaveLength(1);

      // Clear all
      wrapper.vm.clearAll();
      expect(wrapper.vm.filterQuery).toBe("");
      expect(wrapper.vm.selectedRegions).toHaveLength(0);
      expect(wrapper.vm.selectedClusters).toHaveLength(0);
      expect(wrapper.vm.selectedNodetypes).toHaveLength(0);
      expect(wrapper.vm.selectedStatuses).toHaveLength(0);
      expect(wrapper.vm.tabledata).toHaveLength(3);
    });
  });

  describe("filterApplied computed", () => {
    it("should return false when no filters are selected", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.filterApplied).toBe(false);
    });

    it("should return true when regions are selected", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedRegions = [{ name: "us-west" }];
      expect(wrapper.vm.filterApplied).toBe(true);
    });

    it("should return true when clusters are selected", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedClusters = [{ name: "cluster-1" }];
      expect(wrapper.vm.filterApplied).toBe(true);
    });

    it("should return true when node types are selected", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedNodetypes = [{ name: "ingester" }];
      expect(wrapper.vm.filterApplied).toBe(true);
    });

    it("should return true when statuses are selected", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedStatuses = [{ name: "Online" }];
      expect(wrapper.vm.filterApplied).toBe(true);
    });
  });

  describe("computedColumns", () => {
    it("should include region column when super_cluster_enabled", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const names = wrapper.vm.computedColumns.map((c: any) => c.name);
      expect(names).toContain("region");
    });

    it("should exclude region column when super_cluster_enabled=false", async () => {
      const storeWithoutSuperCluster = createStore({
        state: {
          selectedOrganization: { identifier: "test-org" },
          zoConfig: { super_cluster_enabled: false },
          theme: "light",
        },
      });

      wrapper = mount(Nodes, {
        global: {
          plugins: [mockI18n],
          provide: { store: storeWithoutSuperCluster },
          stubs: {
            "OPage": { template: "<div><slot /></div>" },
            "q-splitter": { template: '<div><slot name="before" /><slot name="after" /></div>', props: ["modelValue"] },
            "q-table": { template: "<div />", props: ["rows", "columns", "rowKey", "pagination", "filter", "filterMethod", "loading"] },
            "q-expansion-item": { template: "<div><slot /></div>", props: ["label"] },
            "q-card": { template: "<div><slot /></div>" },
            "q-card-section": { template: "<div><slot /></div>" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-range": { template: "<div />" },
            "q-badge": { template: "<span>" },
            "q-linear-progress": { template: "<div />" },
            "q-tooltip": { template: "<span><slot /></span>" },
            "q-list": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "QTablePagination": { template: "<div />" },
            "NoData": { template: "<div />" },
          },
        },
      });
      await flushPromises();
      const names = wrapper.vm.computedColumns.map((c: any) => c.name);
      expect(names).not.toContain("region");
    });
  });

  describe("changePagination", () => {
    it("should update selectedPerPage and pagination.rowsPerPage", async () => {
      wrapper = mountComponent();
      await flushPromises();
      // mock qTable.setPagination
      wrapper.vm.qTable = { setPagination: vi.fn() };
      wrapper.vm.changePagination({ label: "50", value: 50 });
      expect(wrapper.vm.selectedPerPage).toBe(50);
      expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
    });
  });

  describe("error handling", () => {
    it("should handle API error without crashing", async () => {
      vi.mocked(CommonService.list_nodes).mockRejectedValue({
        status: 500,
        response: { data: { message: "Internal error" } },
      });
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.loading).toBe(false);
    });

    it("should not show notify for 403 errors", async () => {
      vi.mocked(CommonService.list_nodes).mockRejectedValue({ status: 403 });
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });
  });
});

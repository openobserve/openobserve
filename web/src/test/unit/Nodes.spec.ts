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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import Nodes from "../../components/settings/Nodes.vue";
import store from "./helpers/store";
import { createI18n } from "vue-i18n";
import CommonService from "../../services/common";

// Mock services
vi.mock("../../services/common", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list_nodes: vi.fn(),
    },
  });
});

// Mock router
const mockPush = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock composables
vi.mock("../../composables/useIsMetaOrg", () => ({
  default: () => ({
    isMetaOrg: { value: false },
  }),
}));

// Create i18n instance
const i18n = createI18n({
  locale: "en",
  messages: {
    en: {
      nodes: {
        name: "Name",
        region: "Region",
        version: "Version",
        cpu: "CPU",
        memory: "Memory",
        tcp: "TCP",
      },
    },
  },
});

describe("Nodes.vue", () => {
  let wrapper: any;

  const mockNodesData = {
    region1: {
      cluster1: [
        {
          name: "node1",
          status: "active",
          role: ["ingest", "query"],
          version: "v1.0.0",
          metrics: {
            cpu_usage: 45.5,
            memory_usage: 2000,
            memory_total: 8000,
            tcp_conns_established: 15,
            tcp_conns_close_wait: 5,
            tcp_conns_time_wait: 10,
          },
        },
        {
          name: "node2",
          status: "inactive",
          role: ["compact"],
          version: "v1.1.0",
          metrics: {
            cpu_usage: 70.2,
            memory_usage: 4000,
            memory_total: 8000,
            tcp_conns_established: 30,
            tcp_conns_close_wait: 8,
            tcp_conns_time_wait: 12,
          },
        },
      ],
      cluster2: [
        {
          name: "node3",
          status: "active",
          role: ["query"],
          version: "v1.0.0",
          metrics: {
            cpu_usage: 25.0,
            memory_usage: 1000,
            memory_total: 4000,
            tcp_conns_established: 5,
            tcp_conns_close_wait: 2,
            tcp_conns_time_wait: 3,
          },
        },
      ],
    },
    region2: {
      cluster3: [
        {
          name: "node4",
          status: "maintenance",
          role: ["ingest"],
          version: "v1.2.0",
          metrics: {
            cpu_usage: 90.8,
            memory_usage: 6000,
            memory_total: 8000,
            tcp_conns_established: 50,
            tcp_conns_close_wait: 15,
            tcp_conns_time_wait: 20,
          },
        },
      ],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    wrapper = mount(Nodes, {
      global: {
        plugins: [store, i18n],
        stubs: {
          Pagination: true,
          NoData: true,
        },
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // Test 3: flattenObject function with valid data
  it("should flatten nested node data correctly", () => {
    const result = wrapper.vm.flattenObject(mockNodesData);

    expect(result.flattenedData).toHaveLength(4);
    expect(result.flattenedData[0]).toMatchObject({
      region: "region1",
      cluster: "cluster1",
      name: "node1",
      status: "active",
      role: ["ingest", "query"],
      id: "01",
      cpu_usage: 46,
      percentage_memory_usage: 25,
    });

    expect(result.uniqueValues.regions).toEqual(["region1", "region2"]);
    expect(result.uniqueValues.clusters).toEqual(["cluster1", "cluster2", "cluster3"]);
    expect(result.uniqueValues.nodeTypes).toEqual(["ingest", "query", "compact"]);
    expect(result.uniqueValues.statuses).toEqual(["active", "inactive", "maintenance"]);

    expect(result.maxValues.cpuUsage.value).toBe(91);
    expect(result.maxValues.percentageMemoryUsage.value).toBe(75);
  });

  // Test 4: flattenObject with empty data
  it("should handle empty data in flattenObject", () => {
    const result = wrapper.vm.flattenObject({});

    expect(result.flattenedData).toEqual([]);
    expect(result.uniqueValues.regions).toEqual([]);
    expect(result.uniqueValues.clusters).toEqual([]);
    expect(result.uniqueValues.nodeTypes).toEqual([]);
    expect(result.uniqueValues.statuses).toEqual([]);
  });

  // Test 5: flattenObject with zero memory usage
  it("should handle zero memory usage in flattenObject", () => {
    const dataWithZeroMemory = {
      region1: {
        cluster1: [
          {
            name: "node1",
            status: "active",
            role: ["ingest"],
            metrics: {
              cpu_usage: 50,
              memory_usage: 0,
              memory_total: 8000,
              tcp_conns_established: 10,
              tcp_conns_close_wait: 5,
              tcp_conns_time_wait: 8,
            },
          },
        ],
      },
    };

    const result = wrapper.vm.flattenObject(dataWithZeroMemory);
    expect(result.flattenedData[0].percentage_memory_usage).toBe(0);
  });

  // Test 7: filterData function with matching terms
  it("should filter data by name and version correctly", () => {
    const testData = [
      { name: "node1", version: "v1.0.0" },
      { name: "node2", version: "v1.1.0" },
      { name: "test-node", version: "v2.0.0" },
    ];

    const result = wrapper.vm.filterData(testData, "node1");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("node1");

    const result2 = wrapper.vm.filterData(testData, "v1.");
    expect(result2).toHaveLength(2);
  });

  // Test 9: filterRegionData function
  it("should filter region data correctly", () => {
    const regionData = [{ name: "region1" }, { name: "region2" }, { name: "us-east-1" }];

    const result = wrapper.vm.filterRegionData(regionData, "region");
    expect(result).toHaveLength(2);

    const result2 = wrapper.vm.filterRegionData(regionData, "us-");
    expect(result2).toHaveLength(1);
    expect(result2[0].name).toBe("us-east-1");
  });

  // Test 11: computedOTableColumns with super_cluster_enabled = true
  // The component exposes computedOTableColumns (OTableColumnDef), not computedColumns.
  it("should include region column when super_cluster_enabled is true", async () => {
    store.state.zoConfig.super_cluster_enabled = true;
    await wrapper.vm.$nextTick();

    const columns = wrapper.vm.computedOTableColumns;
    // OTableColumnDef uses 'id' not 'name'; region column has id: "region"
    const regionColumn = columns.find((col: any) => col.id === "region");
    expect(regionColumn).toBeDefined();
    // The header uses t("nodes.region") which resolves to "Region" via our i18n setup
    expect(regionColumn.header).toBe("Region");
  });

  // Test 12: computedOTableColumns with super_cluster_enabled = false
  it("should exclude region column when super_cluster_enabled is false", async () => {
    store.state.zoConfig.super_cluster_enabled = false;
    await wrapper.vm.$nextTick();

    const columns = wrapper.vm.computedOTableColumns;
    const regionColumn = columns.find((col: any) => col.id === "region");
    expect(regionColumn).toBeUndefined();
  });

  // Test 13: clearAll function
  it("should clear all filters and reset data", async () => {
    // Set some filters first
    wrapper.vm.filterQuery = "test";
    wrapper.vm.selectedRegions = [{ name: "region1" }];
    wrapper.vm.selectedClusters = [{ name: "cluster1" }];
    wrapper.vm.selectedNodetypes = [{ name: "ingest" }];
    wrapper.vm.selectedStatuses = [{ name: "active" }];
    wrapper.vm.cpuUsage = { min: 10, max: 50 };
    wrapper.vm.maxCPUUsage = 100;

    wrapper.vm.clearAll();

    expect(wrapper.vm.filterQuery).toBe("");
    expect(wrapper.vm.selectedRegions).toEqual([]);
    expect(wrapper.vm.selectedClusters).toEqual([]);
    expect(wrapper.vm.selectedNodetypes).toEqual([]);
    expect(wrapper.vm.selectedStatuses).toEqual([]);
    expect(wrapper.vm.cpuUsage).toEqual({ min: 0, max: 100 });
  });

  // Test 15: filterApplied computed property - with filters
  it("should return true when filters are applied", () => {
    wrapper.vm.selectedRegions = [{ name: "region1" }];

    expect(wrapper.vm.filterApplied).toBe(true);
  });

  // Test 27: applyFilter with no matching results
  it("should return empty results when no data matches filters", () => {
    const testData = [
      {
        name: "node1",
        region: "region1",
        cluster: "cluster1",
        role: ["ingest"],
        status: "active",
        cpu_usage: 50,
        percentage_memory_usage: 50,
        tcp_conns_established: 10,
        tcp_conns_close_wait: 5,
        tcp_conns_time_wait: 8,
      },
    ];

    wrapper.vm.originalData = testData;
    wrapper.vm.filterQuery = "nonexistent";
    wrapper.vm.cpuUsage = { min: 0, max: 100 };
    wrapper.vm.memoryUsage = { min: 0, max: 100 };
    wrapper.vm.establishedUsage = { min: 0, max: 60 };
    wrapper.vm.closewaitUsage = { min: 0, max: 60 };
    wrapper.vm.waittimeUsage = { min: 0, max: 60 };

    wrapper.vm.applyFilter();

    expect(wrapper.vm.tabledata).toHaveLength(0);
    expect(wrapper.vm.resultTotal).toBe(0);
  });

  // Test 28: getData success case
  // The component uses toast() from @/lib/feedback/Toast/useToast.
  it("should handle successful data fetch", async () => {
    const mockResponse = { data: mockNodesData };
    vi.mocked(CommonService.list_nodes).mockResolvedValue(mockResponse);

    await wrapper.vm.getData();
    await flushPromises();

    expect(CommonService.list_nodes).toHaveBeenCalledWith(
      store.state.selectedOrganization.identifier,
    );
    expect(wrapper.vm.loading).toBe(false);
    expect(wrapper.vm.tabledata).toHaveLength(4);
    expect(wrapper.vm.regionRows).toHaveLength(2);
    expect(wrapper.vm.clusterRows).toHaveLength(3);
  });

  // Test 35: Case insensitive filtering
  it("should perform case insensitive filtering in filterData", () => {
    const testData = [
      { name: "Node1", version: "V1.0.0" },
      { name: "NODE2", version: "v1.1.0" },
    ];

    const result = wrapper.vm.filterData(testData, "node");
    expect(result).toHaveLength(2);

    const result2 = wrapper.vm.filterData(testData, "NODE1");
    expect(result2).toHaveLength(1);
    expect(result2[0].name).toBe("Node1");
  });
});

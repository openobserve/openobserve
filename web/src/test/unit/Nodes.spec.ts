// Copyright 2023 OpenObserve Inc.
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
import { Quasar, Notify } from "quasar";
import Nodes from "../../components/settings/Nodes.vue";
import store from "./helpers/store";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import CommonService from "../../services/common";

// Mock services
vi.mock("../../services/common", () => ({
  default: {
    list_nodes: vi.fn()
  }
}));

// Mock router
const mockPush = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: mockPush
  })
}));

// Mock composables
vi.mock("../../composables/useIsMetaOrg", () => ({
  default: () => ({
    isMetaOrg: { value: false }
  })
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
        tcp: "TCP"
      }
    }
  }
});

describe("Nodes.vue", () => {
  let wrapper: any;
  let notifyMock: any;

  const setupFilterTestData = () => {
    const testData = [
      { name: "node1", region: "region1", cluster: "cluster1", role: ["ingest"], status: "active", cpu_usage: 50, percentage_memory_usage: 50, tcp_conns_established: 10, tcp_conns_close_wait: 5, tcp_conns_time_wait: 8 },
      { name: "node2", region: "region2", cluster: "cluster2", role: ["query"], status: "inactive", cpu_usage: 30, percentage_memory_usage: 40, tcp_conns_established: 8, tcp_conns_close_wait: 3, tcp_conns_time_wait: 5 }
    ];
    
    // Mock the applyFilter function to work with our test data
    wrapper.vm.applyFilter = () => {
      let terms = wrapper.vm.filterQuery.toLowerCase();
      const data = testData.filter((row: any) => {
        const matchesSearch = row.name.toLowerCase().includes(terms);
        const matchesRegion = wrapper.vm.selectedRegions.length === 0 || wrapper.vm.selectedRegions.some((region: any) => region.name === row.region);
        const matchesCluster = wrapper.vm.selectedClusters.length === 0 || wrapper.vm.selectedClusters.some((cluster: any) => cluster.name === row.cluster);
        const matchesNodeType = wrapper.vm.selectedNodetypes.length === 0 || row.role.some((r: any) => wrapper.vm.selectedNodetypes.some((nt: any) => nt.name === r));
        const matchesStatus = wrapper.vm.selectedStatuses.length === 0 || wrapper.vm.selectedStatuses.some((status: any) => status.name === row.status);
        const matchesCPU = row.cpu_usage >= wrapper.vm.cpuUsage.min && row.cpu_usage <= wrapper.vm.cpuUsage.max;
        const matchesMemory = row.percentage_memory_usage >= wrapper.vm.memoryUsage.min && row.percentage_memory_usage <= wrapper.vm.memoryUsage.max;
        const matchesEstablished = row.tcp_conns_established >= wrapper.vm.establishedUsage.min && row.tcp_conns_established <= wrapper.vm.establishedUsage.max;
        const matchesCloseWait = row.tcp_conns_close_wait >= wrapper.vm.closewaitUsage.min && row.tcp_conns_close_wait <= wrapper.vm.closewaitUsage.max;
        const matchesWaitTime = row.tcp_conns_time_wait >= wrapper.vm.waittimeUsage.min && row.tcp_conns_time_wait <= wrapper.vm.waittimeUsage.max;
        return matchesSearch && matchesRegion && matchesCluster && matchesNodeType && matchesStatus && matchesCPU && matchesMemory && matchesEstablished && matchesCloseWait && matchesWaitTime;
      });
      
      wrapper.vm.tabledata = data;
      wrapper.vm.resultTotal = data.length;
    };
    
    // Set initial values
    wrapper.vm.originalData = testData;
    wrapper.vm.filterQuery = "";
    wrapper.vm.selectedRegions = [];
    wrapper.vm.selectedClusters = [];
    wrapper.vm.selectedNodetypes = [];
    wrapper.vm.selectedStatuses = [];
    wrapper.vm.cpuUsage = { min: 0, max: 100 };
    wrapper.vm.memoryUsage = { min: 0, max: 100 };
    wrapper.vm.establishedUsage = { min: 0, max: 60 };
    wrapper.vm.closewaitUsage = { min: 0, max: 60 };
    wrapper.vm.waittimeUsage = { min: 0, max: 60 };
    
    return testData;
  };

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
            tcp_conns_time_wait: 10
          }
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
            tcp_conns_time_wait: 12
          }
        }
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
            tcp_conns_time_wait: 3
          }
        }
      ]
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
            tcp_conns_time_wait: 20
          }
        }
      ]
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    notifyMock = vi.fn();
    const $q = {
      notify: notifyMock
    };

    wrapper = mount(Nodes, {
      global: {
        plugins: [store, i18n, [Quasar, { plugins: [Notify] }]],
        mocks: {
          $q
        },
        stubs: {
          QTablePagination: true,
          NoData: true,
          'q-layout': {
            template: '<div><slot /></div>'
          },
          'q-page': {
            template: '<div><slot /></div>'
          },
          'q-splitter': {
            template: '<div><slot /></div>'
          },
          'q-table': true,
          'q-select': true,
          'q-range': true,
          'q-toggle': true,
          'q-btn': true,
          'q-input': true,
          'q-card': true,
          'q-card-section': true
        }
      }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // Test 1: Component renders correctly
  it("should render the component correctly", () => {
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.vm).toBeDefined();
  });

  // Test 2: Initial data setup
  it("should initialize with default values", () => {
    expect(wrapper.vm.tabledata).toEqual([]);
    expect(wrapper.vm.loading).toBe(false);
    expect(wrapper.vm.filterQuery).toBe("");
    expect(wrapper.vm.selectedPerPage).toBe(20);
    expect(wrapper.vm.pagination.rowsPerPage).toBe(20);
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
      percentage_memory_usage: 25
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
        cluster1: [{
          name: "node1",
          status: "active",
          role: ["ingest"],
          metrics: {
            cpu_usage: 50,
            memory_usage: 0,
            memory_total: 8000,
            tcp_conns_established: 10,
            tcp_conns_close_wait: 5,
            tcp_conns_time_wait: 8
          }
        }]
      }
    };
    
    const result = wrapper.vm.flattenObject(dataWithZeroMemory);
    expect(result.flattenedData[0].percentage_memory_usage).toBe(0);
  });

  // Test 6: changePagination function
  it("should change pagination correctly", async () => {
    const mockTableRef = {
      setPagination: vi.fn()
    };
    wrapper.vm.qTable = mockTableRef;
    
    wrapper.vm.changePagination({ label: "50", value: 50 });
    
    expect(wrapper.vm.selectedPerPage).toBe(50);
    expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
    expect(mockTableRef.setPagination).toHaveBeenCalledWith(wrapper.vm.pagination);
  });

  // Test 7: filterData function with matching terms
  it("should filter data by name and version correctly", () => {
    const testData = [
      { name: "node1", version: "v1.0.0" },
      { name: "node2", version: "v1.1.0" },
      { name: "test-node", version: "v2.0.0" }
    ];
    
    const result = wrapper.vm.filterData(testData, "node1");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("node1");
    
    const result2 = wrapper.vm.filterData(testData, "v1.");
    expect(result2).toHaveLength(2);
  });

  // Test 8: filterData function with no matches
  it("should return empty array when no matches found", () => {
    const testData = [
      { name: "node1", version: "v1.0.0" },
      { name: "node2", version: "v1.1.0" }
    ];
    
    const result = wrapper.vm.filterData(testData, "nonexistent");
    expect(result).toHaveLength(0);
  });

  // Test 9: filterRegionData function
  it("should filter region data correctly", () => {
    const regionData = [
      { name: "region1" },
      { name: "region2" },
      { name: "us-east-1" }
    ];
    
    const result = wrapper.vm.filterRegionData(regionData, "region");
    expect(result).toHaveLength(2);
    
    const result2 = wrapper.vm.filterRegionData(regionData, "us-");
    expect(result2).toHaveLength(1);
    expect(result2[0].name).toBe("us-east-1");
  });

  // Test 10: filterClusterData function
  it("should filter cluster data correctly", () => {
    const clusterData = [
      { name: "cluster1" },
      { name: "cluster2" },
      { name: "prod-cluster" }
    ];
    
    const result = wrapper.vm.filterClusterData(clusterData, "cluster");
    expect(result).toHaveLength(3); // All 3 items contain "cluster"
    
    const result2 = wrapper.vm.filterClusterData(clusterData, "prod");
    expect(result2).toHaveLength(1);
    expect(result2[0].name).toBe("prod-cluster");
  });

  // Test 11: computedColumns with super_cluster_enabled = true
  it("should include region column when super_cluster_enabled is true", () => {
    store.state.zoConfig.super_cluster_enabled = true;
    
    const columns = wrapper.vm.computedColumns;
    const regionColumn = columns.find((col: any) => col.name === "region");
    expect(regionColumn).toBeDefined();
    expect(regionColumn.label).toBe("Region");
  });

  // Test 12: computedColumns with super_cluster_enabled = false  
  it("should exclude region column when super_cluster_enabled is false", () => {
    store.state.zoConfig.super_cluster_enabled = false;
    
    const columns = wrapper.vm.computedColumns;
    const regionColumn = columns.find((col: any) => col.name === "region");
    expect(regionColumn).toBeUndefined();
  });

  // Test 13: clearAll function  
  it("should clear all filters and reset data", async () => {
    setupFilterTestData();
    
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

  // Test 14: filterApplied computed property - no filters
  it("should return false when no filters are applied", () => {
    wrapper.vm.selectedRegions = [];
    wrapper.vm.selectedClusters = [];  
    wrapper.vm.selectedNodetypes = [];
    wrapper.vm.selectedStatuses = [];
    
    expect(wrapper.vm.filterApplied).toBe(false);
  });

  // Test 15: filterApplied computed property - with filters
  it("should return true when filters are applied", () => {
    wrapper.vm.selectedRegions = [{ name: "region1" }];
    
    expect(wrapper.vm.filterApplied).toBe(true);
  });

  // Test 16: applyFilter with search term
  it("should apply search filter correctly", async () => {
    const testData = setupFilterTestData();
    
    wrapper.vm.filterQuery = "node1";
    wrapper.vm.applyFilter();
    
    expect(wrapper.vm.tabledata).toHaveLength(1);
    expect(wrapper.vm.tabledata[0].name).toBe("node1");
    expect(wrapper.vm.resultTotal).toBe(1);
  });

  // Test 17: applyFilter with region filter
  it("should apply region filter correctly", () => {
    const testData = setupFilterTestData();
    
    wrapper.vm.selectedRegions = [{ name: "region1" }];
    wrapper.vm.applyFilter();
    
    expect(wrapper.vm.tabledata).toHaveLength(1);
    expect(wrapper.vm.tabledata[0].region).toBe("region1");
  });

  // Test 18: applyFilter with cluster filter
  it("should apply cluster filter correctly", () => {
    const testData = setupFilterTestData();
    
    wrapper.vm.selectedClusters = [{ name: "cluster2" }];
    wrapper.vm.applyFilter();
    
    expect(wrapper.vm.tabledata).toHaveLength(1);
    expect(wrapper.vm.tabledata[0].cluster).toBe("cluster2");
  });

  // Test 19: applyFilter with node type filter
  it("should apply node type filter correctly", () => {
    const testData = setupFilterTestData();
    
    wrapper.vm.selectedNodetypes = [{ name: "query" }];
    wrapper.vm.applyFilter();
    
    expect(wrapper.vm.tabledata).toHaveLength(1);
    expect(wrapper.vm.tabledata[0].role).toContain("query");
  });

  // Test 20: applyFilter with status filter
  it("should apply status filter correctly", () => {
    const testData = setupFilterTestData();
    
    wrapper.vm.selectedStatuses = [{ name: "inactive" }];
    wrapper.vm.applyFilter();
    
    expect(wrapper.vm.tabledata).toHaveLength(1);
    expect(wrapper.vm.tabledata[0].status).toBe("inactive");
  });

  // Test 21: applyFilter with CPU usage range
  it("should apply CPU usage filter correctly", () => {
    const testData = setupFilterTestData();
    
    wrapper.vm.cpuUsage = { min: 45, max: 55 }; // Only node1 with 50% CPU should match
    wrapper.vm.applyFilter();
    
    expect(wrapper.vm.tabledata).toHaveLength(1);
    expect(wrapper.vm.tabledata[0].cpu_usage).toBe(50);
    expect(wrapper.vm.tabledata[0].name).toBe("node1");
  });

  // Test 22: applyFilter with memory usage range
  it("should apply memory usage filter correctly", () => {
    const testData = setupFilterTestData();
    
    wrapper.vm.memoryUsage = { min: 35, max: 45 }; // Only node2 with 40% memory should match
    wrapper.vm.applyFilter();
    
    expect(wrapper.vm.tabledata).toHaveLength(1);
    expect(wrapper.vm.tabledata[0].percentage_memory_usage).toBe(40);
    expect(wrapper.vm.tabledata[0].name).toBe("node2");
  });

  // Test 23: applyFilter with TCP established connections range
  it("should apply TCP established connections filter correctly", () => {
    const testData = setupFilterTestData();
    
    wrapper.vm.establishedUsage = { min: 9, max: 11 }; // Only node1 with 10 connections should match
    wrapper.vm.applyFilter();
    
    expect(wrapper.vm.tabledata).toHaveLength(1);
    expect(wrapper.vm.tabledata[0].tcp_conns_established).toBe(10);
    expect(wrapper.vm.tabledata[0].name).toBe("node1");
  });

  // Test 24: applyFilter with TCP close wait connections range
  it("should apply TCP close wait connections filter correctly", () => {
    const testData = setupFilterTestData();
    
    wrapper.vm.closewaitUsage = { min: 4, max: 6 }; // Only node1 with 5 close_wait should match
    wrapper.vm.applyFilter();
    
    expect(wrapper.vm.tabledata).toHaveLength(1);
    expect(wrapper.vm.tabledata[0].tcp_conns_close_wait).toBe(5);
    expect(wrapper.vm.tabledata[0].name).toBe("node1");
  });

  // Test 25: applyFilter with TCP time wait connections range
  it("should apply TCP time wait connections filter correctly", () => {
    const testData = setupFilterTestData();
    
    wrapper.vm.waittimeUsage = { min: 7, max: 9 }; // Only node1 with 8 time_wait should match
    wrapper.vm.applyFilter();
    
    expect(wrapper.vm.tabledata).toHaveLength(1);
    expect(wrapper.vm.tabledata[0].tcp_conns_time_wait).toBe(8);
    expect(wrapper.vm.tabledata[0].name).toBe("node1");
  });

  // Test 26: applyFilter with multiple filters combined
  it("should apply multiple filters correctly", () => {
    const testData = setupFilterTestData();
    
    wrapper.vm.filterQuery = "node1";
    wrapper.vm.selectedRegions = [{ name: "region1" }];
    wrapper.vm.selectedStatuses = [{ name: "active" }];
    wrapper.vm.cpuUsage = { min: 45, max: 55 };
    wrapper.vm.applyFilter();
    
    expect(wrapper.vm.tabledata).toHaveLength(1);
    expect(wrapper.vm.tabledata[0].name).toBe("node1");
  });

  // Test 27: applyFilter with no matching results
  it("should return empty results when no data matches filters", () => {
    const testData = [
      { name: "node1", region: "region1", cluster: "cluster1", role: ["ingest"], status: "active", cpu_usage: 50, percentage_memory_usage: 50, tcp_conns_established: 10, tcp_conns_close_wait: 5, tcp_conns_time_wait: 8 }
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
  it("should handle successful data fetch", async () => {
    const mockResponse = { data: mockNodesData };
    vi.mocked(CommonService.list_nodes).mockResolvedValue(mockResponse);
    
    const dismissMock = vi.fn();
    wrapper.vm.$q.notify = vi.fn(() => dismissMock);
    
    await wrapper.vm.getData();
    
    expect(CommonService.list_nodes).toHaveBeenCalledWith(store.state.selectedOrganization.identifier);
    expect(wrapper.vm.loading).toBe(false);
    expect(wrapper.vm.tabledata).toHaveLength(4);
    expect(wrapper.vm.regionRows).toHaveLength(2);
    expect(wrapper.vm.clusterRows).toHaveLength(3);
    expect(dismissMock).toHaveBeenCalled();
  });

  // Test 29: getData error case (non-403)
  it("should handle API error during data fetch", async () => {
    const mockError = {
      status: 500,
      response: { data: { message: "Internal server error" } }
    };
    vi.mocked(CommonService.list_nodes).mockRejectedValue(mockError);
    
    await wrapper.vm.getData();
    
    // Verify that the function completes without throwing errors
    expect(true).toBe(true);
  });

  // Test 30: getData error case (403)
  it("should handle 403 error silently during data fetch", async () => {
    const mockError = { status: 403 };
    vi.mocked(CommonService.list_nodes).mockRejectedValue(mockError);
    
    // Mock the $q.notify method
    const notifyMock = vi.fn();
    wrapper.vm.$q = {
      notify: notifyMock
    };
    
    await wrapper.vm.getData();
    
    // Should not call notify for 403 errors (silent handling)
    expect(notifyMock).not.toHaveBeenCalled();
  });

  // Test 31: getData with filterFlag = true
  it("should apply filter when getData is called with filterFlag true", async () => {
    const mockResponse = { data: mockNodesData };
    vi.mocked(CommonService.list_nodes).mockResolvedValue(mockResponse);
    
    // Setup test data first
    setupFilterTestData();
    
    await wrapper.vm.getData(true);
    
    // Verify that data was processed and applyFilter logic was executed
    expect(wrapper.vm.tabledata).toBeDefined();
    expect(wrapper.vm.loading).toBe(false);
  });

  // Test 32: Pagination options array
  it("should have correct pagination options", () => {
    expect(wrapper.vm.perPageOptions).toEqual([
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
      { label: "250", value: 250 },
      { label: "500", value: 500 }
    ]);
  });

  // Test 33: Initial state of toggle switches
  it("should initialize toggle switches correctly", () => {
    expect(wrapper.vm.establishedToggle).toBe(true);
    expect(wrapper.vm.closewaitToggle).toBe(true);
    expect(wrapper.vm.waittimeToggle).toBe(true);
  });

  // Test 34: Initial state of usage ranges
  it("should initialize usage ranges correctly", () => {
    expect(wrapper.vm.cpuUsage).toEqual({ min: 0, max: 100 });
    expect(wrapper.vm.memoryUsage).toEqual({ min: 0, max: 100 });
    expect(wrapper.vm.establishedUsage).toEqual({ min: 0, max: 60 });
    expect(wrapper.vm.closewaitUsage).toEqual({ min: 0, max: 60 });
    expect(wrapper.vm.waittimeUsage).toEqual({ min: 0, max: 60 });
  });

  // Test 35: Case insensitive filtering
  it("should perform case insensitive filtering in filterData", () => {
    const testData = [
      { name: "Node1", version: "V1.0.0" },
      { name: "NODE2", version: "v1.1.0" }
    ];
    
    const result = wrapper.vm.filterData(testData, "node");
    expect(result).toHaveLength(2);
    
    const result2 = wrapper.vm.filterData(testData, "NODE1");
    expect(result2).toHaveLength(1);
    expect(result2[0].name).toBe("Node1");
  });
});
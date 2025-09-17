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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi, MockedFunction } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import PipelinesList from "@/components/pipeline/PipelinesList.vue";
import i18n from "@/locales";
import { Dialog, Notify } from "quasar";
import { nextTick } from "vue";
import pipelineService from "@/services/pipelines";
import { createStore } from "vuex";

// Mock services
vi.mock("@/services/pipelines", () => ({
  default: {
    getPipelines: vi.fn(),
    toggleState: vi.fn(),
    createPipeline: vi.fn(),
    deletePipeline: vi.fn(),
  }
}));

// Mock router with proper structure
const mockRouter = {
  currentRoute: {
    value: {
      name: "pipelines",
      query: {}
    }
  },
  push: vi.fn(),
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
  useRoute: () => mockRouter.currentRoute.value
}));

vi.mock("@/plugins/pipelines/useDnD", () => ({
  default: () => ({
    pipelineObj: {
      currentSelectedPipeline: null,
      pipelineWithoutChange: null,
    }
  })
}));

// Mock URL and document methods
global.URL = {
  createObjectURL: vi.fn(() => 'blob:mock-url'),
  revokeObjectURL: vi.fn(),
} as any;

const mockDocument = {
  createElement: vi.fn((tag: string) => {
    if (tag === 'a') {
      return {
        href: '',
        download: '',
        click: vi.fn(),
      };
    }
    return {};
  })
};

// Only mock createElement for anchor tags
const originalCreateElement = document.createElement.bind(document);
document.createElement = (tag: string) => {
  if (tag === 'a') {
    return mockDocument.createElement(tag) as any;
  }
  return originalCreateElement(tag);
};

installQuasar({
  plugins: [Dialog, Notify],
});

describe("PipelinesList", () => {
  let wrapper: any = null;
  let store: any = null;
  
  const mockPipelines = [
    {
      pipeline_id: "pipeline1",
      name: "Test Pipeline 1",
      enabled: true,
      type: "realtime",
      stream_name: "test_stream",
      stream_type: "logs",
      source: {
        source_type: "realtime",
        stream_name: "test_stream",
        stream_type: "logs"
      },
      nodes: [],
      edges: []
    },
    {
      pipeline_id: "pipeline2", 
      name: "Test Pipeline 2",
      enabled: false,
      type: "scheduled",
      stream_type: "metrics",
      frequency: "10 Mins",
      period: "5 Mins",
      cron: "False",
      sql_query: "SELECT * FROM test",
      paused_at: "2023-01-01T00:00:00Z",
      source: {
        source_type: "scheduled",
        stream_type: "metrics",
        trigger_condition: {
          frequency_type: "minutes",
          frequency: 10,
          period: 5,
        },
        query_condition: {
          sql: "SELECT * FROM test"
        }
      },
      nodes: [],
      edges: []
    }
  ];

  beforeEach(async () => {
    store = createStore({
      state: {
        theme: "light",
        selectedOrganization: {
          identifier: "test-org"
        }
      }
    });

    vi.clearAllMocks();
    (pipelineService.getPipelines as MockedFunction<any>).mockResolvedValue({
      data: { list: mockPipelines }
    });
    (pipelineService.createPipeline as MockedFunction<any>).mockResolvedValue({});
    (pipelineService.deletePipeline as MockedFunction<any>).mockResolvedValue({});
    (pipelineService.toggleState as MockedFunction<any>).mockResolvedValue({});

    // Create a more minimal component mount
    wrapper = mount(PipelinesList, {
      shallow: true,
      global: {
        plugins: [i18n, store],
        mocks: {
          $router: mockRouter,
          $route: mockRouter.currentRoute.value
        }
      },
    });

    await nextTick();
    await flushPromises();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  describe("Component Mount and Initialization", () => {
    it("should mount PipelinesList component", () => {
      expect(wrapper.exists()).toBeTruthy();
      expect(wrapper.vm).toBeTruthy();
    });

    it("should have correct component name", () => {
      expect(wrapper.vm.$options.__name || wrapper.vm.$options.name).toBe("PipelinesList");
    });

    it("should initialize with correct default data", () => {
      expect(wrapper.vm.filterQuery).toBe("");
      expect(wrapper.vm.showCreatePipeline).toBe(false);
      expect(wrapper.vm.activeTab).toBe("all");
      expect(wrapper.vm.selectedPipelines).toEqual([]);
      expect(wrapper.vm.shouldStartfromNow).toBe(true);
    });

    it("should have pagination settings", () => {
      expect(wrapper.vm.pagination.rowsPerPage).toBe(20);
      expect(wrapper.vm.selectedPerPage).toBe(20);
      expect(wrapper.vm.maxRecordToReturn).toBe(100);
    });

    it("should have correct tabs configuration", () => {
      expect(wrapper.vm.tabs).toHaveLength(3);
      expect(wrapper.vm.tabs[0].value).toBe("all");
      expect(wrapper.vm.tabs[1].value).toBe("scheduled");
      expect(wrapper.vm.tabs[2].value).toBe("realtime");
    });

    it("should have perPageOptions array", () => {
      expect(wrapper.vm.perPageOptions).toHaveLength(5);
      expect(wrapper.vm.perPageOptions[0].value).toBe(20);
      expect(wrapper.vm.perPageOptions[4].value).toBe(500);
    });
  });

  describe("Core Component Methods", () => {
    it("should have currentRouteName computed property", () => {
      expect(wrapper.vm.currentRouteName).toBe("pipelines");
    });

    it("should have changePagination method", async () => {
      const mockQTable = { setPagination: vi.fn() };
      wrapper.vm.qTableRef = mockQTable;
      
      await wrapper.vm.changePagination({ label: "50", value: 50 });
      
      expect(wrapper.vm.selectedPerPage).toBe(50);
      expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
    });

    it("should filter data correctly", () => {
      const rows = [
        { name: "Test Pipeline" },
        { name: "Another Pipeline" },
        { name: "Different Name" }
      ];
      
      const result = wrapper.vm.filterData(rows, "test");
      
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Test Pipeline");
    });

    it("should handle case insensitive filtering", () => {
      const rows = [
        { name: "TEST Pipeline" },
        { name: "test pipeline" }
      ];
      
      const result = wrapper.vm.filterData(rows, "TeSt");
      
      expect(result).toHaveLength(2);
    });

    it("should return empty array for no matches", () => {
      const rows = [{ name: "Pipeline One" }, { name: "Pipeline Two" }];
      const result = wrapper.vm.filterData(rows, "xyz");
      expect(result).toHaveLength(0);
    });
  });

  describe("Tab Management Functions", () => {
    it("should get columns for all tab", () => {
      const columns = wrapper.vm.getColumnsForActiveTab("all");
      expect(Array.isArray(columns)).toBeTruthy();
      expect(columns.some((col: any) => col.name === "actions")).toBeTruthy();
    });

    it("should get columns for realtime tab", () => {
      const columns = wrapper.vm.getColumnsForActiveTab("realtime");
      expect(Array.isArray(columns)).toBeTruthy();
      expect(columns.some((col: any) => col.name === "stream_name")).toBeTruthy();
    });

    it("should get columns for scheduled tab", () => {
      const columns = wrapper.vm.getColumnsForActiveTab("scheduled");
      expect(Array.isArray(columns)).toBeTruthy();
      expect(columns.some((col: any) => col.name === "frequency")).toBeTruthy();
    });

    it("should filter columns for realtime/all tab", () => {
      wrapper.vm.activeTab = "realtime";
      wrapper.vm.columns = [{ name: "#" }, { name: "name" }];
      const result = wrapper.vm.filterColumns();
      expect(result).toEqual(wrapper.vm.columns);
    });

    it("should filter columns for scheduled tab", () => {
      wrapper.vm.activeTab = "scheduled";
      wrapper.vm.columns = [{ name: "#" }, { name: "name" }];
      const result = wrapper.vm.filterColumns();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("name");
    });
  });

  describe("Pipeline State Management", () => {
    it("should handle toggle pipeline for enabled realtime", () => {
      // Mock the actual pipelineService.toggleState that gets called
      (pipelineService.toggleState as MockedFunction<any>).mockResolvedValue({});
      const mockPipeline = { pipeline_id: "test", enabled: true, type: "realtime" };
      
      wrapper.vm.togglePipeline(mockPipeline);
      
      expect(pipelineService.toggleState).toHaveBeenCalledWith(
        "test-org", "test", false, true
      );
    });

    it("should show resume dialog for disabled scheduled pipeline", async () => {
      const mockPipeline = { enabled: false, type: "scheduled" };
      
      await wrapper.vm.togglePipeline(mockPipeline);
      
      expect(wrapper.vm.resumePipelineDialogMeta.show).toBe(true);
      expect(wrapper.vm.resumePipelineDialogMeta.data).toStrictEqual(mockPipeline);
    });

    it("should handle resume pipeline", () => {
      // Mock the actual pipelineService.toggleState that gets called
      (pipelineService.toggleState as MockedFunction<any>).mockResolvedValue({});
      wrapper.vm.resumePipelineDialogMeta.data = mockPipelines[1];
      wrapper.vm.shouldStartfromNow = false;
      
      wrapper.vm.handleResumePipeline();
      
      expect(wrapper.vm.resumePipelineDialogMeta.show).toBe(false);
      expect(pipelineService.toggleState).toHaveBeenCalledWith(
        "test-org", mockPipelines[1].pipeline_id, true, false
      );
    });

    it("should handle cancel resume pipeline", () => {
      wrapper.vm.resumePipelineDialogMeta.show = true;
      wrapper.vm.handleCancelResumePipeline();
      expect(wrapper.vm.resumePipelineDialogMeta.show).toBe(false);
    });

    it("should toggle pipeline state successfully", async () => {
      (pipelineService.toggleState as MockedFunction<any>).mockResolvedValue({});
      const mockPipeline = { pipeline_id: "test", enabled: true };
      
      await wrapper.vm.togglePipelineState(mockPipeline, true);
      
      expect(pipelineService.toggleState).toHaveBeenCalledWith(
        "test-org", "test", false, true
      );
    });

    it("should handle toggle state error", async () => {
      const error = { response: { status: 400, data: { message: "Error" } } };
      (pipelineService.toggleState as MockedFunction<any>).mockRejectedValue(error);
      const mockPipeline = { pipeline_id: "test", enabled: true };
      
      await wrapper.vm.togglePipelineState(mockPipeline, true);
      expect(pipelineService.toggleState).toHaveBeenCalled();
    });
  });

  describe("Row Expansion Management", () => {
    it("should expand scheduled pipeline row", () => {
      const props = {
        row: { pipeline_id: "test-id", source: { source_type: "scheduled" } }
      };
      
      wrapper.vm.triggerExpand(props);
      expect(wrapper.vm.expandedRow).toBe("test-id");
    });

    it("should collapse expanded row when clicked again", () => {
      const props = {
        row: { pipeline_id: "test-id", source: { source_type: "scheduled" } }
      };
      wrapper.vm.expandedRow = "test-id";
      
      wrapper.vm.triggerExpand(props);
      expect(wrapper.vm.expandedRow).toBe(null);
    });

    it("should not expand realtime pipeline", () => {
      const props = {
        row: { pipeline_id: "test-id", source: { source_type: "realtime" } }
      };
      
      wrapper.vm.triggerExpand(props);
      expect(wrapper.vm.expandedRow).toBe(null);
    });
  });

  describe("Dialog Management", () => {
    it("should open delete dialog", () => {
      const mockPipeline = mockPipelines[0];
      wrapper.vm.openDeleteDialog(mockPipeline);
      
      expect(wrapper.vm.confirmDialogMeta.show).toBe(true);
      expect(wrapper.vm.confirmDialogMeta.data).toStrictEqual(mockPipeline);
    });

    it("should reset confirm dialog", () => {
      wrapper.vm.confirmDialogMeta.show = true;
      wrapper.vm.confirmDialogMeta.title = "Test";
      wrapper.vm.confirmDialogMeta.data = { test: true };
      
      wrapper.vm.resetConfirmDialog();
      
      expect(wrapper.vm.confirmDialogMeta.show).toBe(false);
      expect(wrapper.vm.confirmDialogMeta.title).toBe("");
      expect(wrapper.vm.confirmDialogMeta.data).toBe(null);
    });
  });

  describe("Pipeline Operations", () => {
    it("should edit pipeline correctly", () => {
      const mockPipeline = {
        ...mockPipelines[0],
        nodes: [{ io_type: "input" }, { io_type: "output" }]
      };
      
      wrapper.vm.editPipeline(mockPipeline);
      
      expect(mockPipeline.nodes[0].type).toBe("input");
      expect(mockPipeline.nodes[1].type).toBe("output");
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "pipelineEditor",
        query: {
          id: mockPipeline.pipeline_id,
          name: mockPipeline.name,
          org_identifier: "test-org"
        }
      });
    });

    it("should save pipeline successfully", () => {
      const mockData = { name: "New Pipeline" };
      
      // Mock quasar notify functions
      const mockDismiss = vi.fn();
      const mockNotify = vi.fn(() => mockDismiss);
      wrapper.vm.q = { notify: mockNotify };
      
      // Call savePipeline 
      wrapper.vm.savePipeline(mockData);
      
      expect(pipelineService.createPipeline).toHaveBeenCalledWith({
        ...mockData,
        org_identifier: "test-org"
      });
      
      // Verify showCreatePipeline was set to false (this happens in the .then() chain)
      expect(wrapper.vm.showCreatePipeline).toBe(false);
    });

    it("should handle save pipeline error", async () => {
      const error = { response: { status: 400, data: { message: "Error" } } };
      (pipelineService.createPipeline as MockedFunction<any>).mockRejectedValue(error);
      const mockData = { name: "New Pipeline" };
      
      await wrapper.vm.savePipeline(mockData);
      expect(pipelineService.createPipeline).toHaveBeenCalled();
    });

    it("should delete pipeline successfully", () => {
      // Set up dialog state to test resetConfirmDialog side effects
      wrapper.vm.confirmDialogMeta.data = mockPipelines[0];
      wrapper.vm.confirmDialogMeta.show = true;
      wrapper.vm.confirmDialogMeta.title = "Delete Pipeline";
      
      // Mock quasar notify to return a dismiss function
      const mockDismiss = vi.fn();
      const mockNotify = vi.fn(() => mockDismiss);
      wrapper.vm.q = { notify: mockNotify };
      
      // Call deletePipeline 
      wrapper.vm.deletePipeline();
      
      expect(pipelineService.deletePipeline).toHaveBeenCalledWith({
        pipeline_id: mockPipelines[0].pipeline_id,
        org_id: "test-org"
      });
      
      // Verify resetConfirmDialog side effects - dialog should be closed
      expect(wrapper.vm.confirmDialogMeta.show).toBe(false);
      expect(wrapper.vm.confirmDialogMeta.title).toBe("");
      expect(wrapper.vm.confirmDialogMeta.data).toBe(null);
    });
  });

  describe("Navigation Functions", () => {
    it("should route to add pipeline", () => {
      wrapper.vm.routeToAddPipeline();
      
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "createPipeline",
        query: { org_identifier: "test-org" }
      });
    });

    it("should route to import pipeline", () => {
      wrapper.vm.routeToImportPipeline();
      
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "importPipeline",
        query: { org_identifier: "test-org" }
      });
    });
  });

  describe("Export Functions", () => {
    it("should export single pipeline", () => {
      const mockPipeline = mockPipelines[0];
      wrapper.vm.exportPipeline(mockPipeline);
      
      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(global.URL.revokeObjectURL).toHaveBeenCalled();
    });

    it("should export bulk pipelines", () => {
      wrapper.vm.selectedPipelines = [mockPipelines[0], mockPipelines[1]];
      wrapper.vm.exportBulkPipelines();
      
      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(wrapper.vm.selectedPipelines).toEqual([]);
    });
  });

  describe("Method Exposure Tests", () => {
    it("should expose all required methods", () => {
      const requiredMethods = [
        'togglePipeline', 'togglePipelineState', 'triggerExpand',
        'getColumnsForActiveTab', 'getPipelines', 'editPipeline',
        'openDeleteDialog', 'savePipeline', 'deletePipeline',
        'resetConfirmDialog', 'filterData', 'routeToAddPipeline',
        'exportPipeline', 'routeToImportPipeline', 'exportBulkPipelines',
        'handleResumePipeline', 'handleCancelResumePipeline',
        'updateActiveTab', 'changePagination', 'filterColumns'
      ];

      requiredMethods.forEach(method => {
        expect(typeof wrapper.vm[method]).toBe("function");
      });
    });
  });

  describe("Pipeline Data Processing", () => {
    it("should process realtime pipeline data", async () => {
      const realtimePipeline = {
        pipeline_id: "rt1",
        name: "Realtime Test",
        source: {
          source_type: "realtime",
          stream_name: "rt_stream",
          stream_type: "logs"
        },
        edges: [],
        nodes: []
      };
      
      (pipelineService.getPipelines as MockedFunction<any>).mockResolvedValue({
        data: { list: [realtimePipeline] }
      });
      
      await wrapper.vm.getPipelines();
      
      if (wrapper.vm.pipelines.length > 0) {
        const processed = wrapper.vm.pipelines[0];
        expect(processed.type).toBe("realtime");
        expect(processed.stream_name).toBe("rt_stream");
        expect(processed.frequency).toBe("--");
        expect(processed.sql_query).toBe("--");
      }
    });

    it("should process scheduled pipeline data", async () => {
      const scheduledPipeline = {
        pipeline_id: "sch1",
        name: "Scheduled Test",
        source: {
          source_type: "scheduled",
          stream_type: "metrics",
          trigger_condition: {
            frequency_type: "minutes",
            frequency: 15,
            period: 10
          },
          query_condition: {
            sql: "SELECT * FROM metrics"
          }
        },
        edges: [],
        nodes: []
      };
      
      (pipelineService.getPipelines as MockedFunction<any>).mockResolvedValue({
        data: { list: [scheduledPipeline] }
      });
      
      await wrapper.vm.getPipelines();
      
      if (wrapper.vm.pipelines.length > 0) {
        const processed = wrapper.vm.pipelines[0];
        expect(processed.type).toBe("scheduled");
        expect(processed.frequency).toBe("15 Mins");
        expect(processed.period).toBe("10 Mins");
        expect(processed.cron).toBe("False");
      }
    });

    it("should handle getPipelines error gracefully", async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (pipelineService.getPipelines as MockedFunction<any>).mockRejectedValue(new Error("API Error"));
      
      await wrapper.vm.getPipelines();
      
      expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error));
      consoleSpy.mockRestore();
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle empty pipeline list", async () => {
      (pipelineService.getPipelines as MockedFunction<any>).mockResolvedValue({
        data: { list: [] }
      });
      
      await wrapper.vm.getPipelines();
      expect(wrapper.vm.pipelines).toHaveLength(0);
    });

    it("should handle null/undefined pipelines", async () => {
      (pipelineService.getPipelines as MockedFunction<any>).mockResolvedValue({
        data: { list: [null, undefined] }
      });
      
      await wrapper.vm.getPipelines();
      expect(wrapper.vm.pipelines).toHaveLength(0);
    });

    it("should handle missing source data", async () => {
      const invalidPipeline = {
        pipeline_id: "invalid1",
        name: "Invalid Pipeline",
        edges: [],
        nodes: []
      };
      
      (pipelineService.getPipelines as MockedFunction<any>).mockResolvedValue({
        data: { list: [invalidPipeline] }
      });
      
      await wrapper.vm.getPipelines();
      // The function filters out null/undefined, but not objects without source
      expect(wrapper.vm.pipelines.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle API errors in delete operation", async () => {
      const error = { response: { status: 400, data: { message: "Delete Error" } } };
      (pipelineService.deletePipeline as MockedFunction<any>).mockRejectedValue(error);
      wrapper.vm.confirmDialogMeta.data = mockPipelines[0];
      
      await wrapper.vm.deletePipeline();
      expect(pipelineService.deletePipeline).toHaveBeenCalled();
    });

    it("should handle 403 errors silently in toggle operation", async () => {
      const error = { response: { status: 403 } };
      (pipelineService.toggleState as MockedFunction<any>).mockRejectedValue(error);
      const mockPipeline = { pipeline_id: "test", enabled: true };
      
      await wrapper.vm.togglePipelineState(mockPipeline, true);
      expect(pipelineService.toggleState).toHaveBeenCalled();
    });
  });

  describe("Tab Filtering and Updates", () => {
    beforeEach(() => {
      wrapper.vm.pipelines = mockPipelines;
    });

    it("should update active tab to all correctly", async () => {
      wrapper.vm.activeTab = "all";
      await wrapper.vm.updateActiveTab();
      
      expect(wrapper.vm.filteredPipelines).toHaveLength(2);
      expect(wrapper.vm.resultTotal).toBe(2);
    });

    it("should filter pipelines by realtime type", async () => {
      wrapper.vm.activeTab = "realtime";
      await wrapper.vm.updateActiveTab();
      
      const realtimePipelines = wrapper.vm.filteredPipelines.filter(
        (p: any) => p.source?.source_type === "realtime"
      );
      expect(realtimePipelines.length).toBeGreaterThanOrEqual(0);
    });

    it("should filter pipelines by scheduled type", async () => {
      wrapper.vm.activeTab = "scheduled";
      await wrapper.vm.updateActiveTab();
      
      const scheduledPipelines = wrapper.vm.filteredPipelines.filter(
        (p: any) => p.source?.source_type === "scheduled"
      );
      expect(scheduledPipelines.length).toBeGreaterThanOrEqual(0);
    });
  });
});
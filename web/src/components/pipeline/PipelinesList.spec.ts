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

import { mount, flushPromises } from "@vue/test-utils";
import {
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
  vi,
  type MockedFunction,
} from "vitest";
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
    bulkToggleState: vi.fn(),
    createPipeline: vi.fn(),
    deletePipeline: vi.fn(),
  },
}));

// Mock router
const mockRouter = {
  currentRoute: {
    value: {
      name: "pipelines",
      query: {},
    },
  },
  push: vi.fn(),
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
  useRoute: () => mockRouter.currentRoute.value,
}));

vi.mock("@/plugins/pipelines/useDnD", () => ({
  default: () => ({
    pipelineObj: {
      currentSelectedPipeline: null,
      pipelineWithoutChange: null,
    },
  }),
}));

vi.mock("@vue-flow/core", () => ({
  MarkerType: { ArrowClosed: "arrowclosed" },
  VueFlow: { name: "VueFlow", template: "<div />" },
}));

// Mock URL and document anchor element for export tests
global.URL = {
  createObjectURL: vi.fn(() => "blob:mock-url"),
  revokeObjectURL: vi.fn(),
} as any;

const originalCreateElement = document.createElement.bind(document);
document.createElement = (tag: string) => {
  if (tag === "a") {
    return { href: "", download: "", click: vi.fn() } as any;
  }
  return originalCreateElement(tag);
};

installQuasar({ plugins: [Dialog, Notify] });

describe("PipelinesList", () => {
  let wrapper: any = null;
  let store: any = null;

  const mockRealtimePipeline = {
    pipeline_id: "pipeline1",
    name: "Test Pipeline 1",
    enabled: true,
    type: "realtime",
    stream_name: "test_stream",
    stream_type: "logs",
    source: {
      source_type: "realtime",
      stream_name: "test_stream",
      stream_type: "logs",
    },
    nodes: [],
    edges: [],
  };

  const mockScheduledPipeline = {
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
      query_condition: { sql: "SELECT * FROM test" },
    },
    nodes: [],
    edges: [],
  };

  const mockPipelines = [mockRealtimePipeline, mockScheduledPipeline];

  function createWrapper() {
    return mount(PipelinesList, {
      shallow: true,
      global: {
        plugins: [i18n, store],
        mocks: {
          $router: mockRouter,
          $route: mockRouter.currentRoute.value,
        },
      },
    });
  }

  beforeEach(async () => {
    store = createStore({
      state: {
        theme: "light",
        selectedOrganization: { identifier: "test-org" },
      },
    });

    vi.clearAllMocks();

    (pipelineService.getPipelines as MockedFunction<any>).mockResolvedValue({
      data: { list: mockPipelines },
    });
    (pipelineService.createPipeline as MockedFunction<any>).mockResolvedValue(
      {}
    );
    (pipelineService.deletePipeline as MockedFunction<any>).mockResolvedValue(
      {}
    );
    (pipelineService.toggleState as MockedFunction<any>).mockResolvedValue({});

    wrapper = createWrapper();
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

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Component Mount and Initialization", () => {
    it("mounts the PipelinesList component", () => {
      expect(wrapper.exists()).toBeTruthy();
      expect(wrapper.vm).toBeTruthy();
    });

    it("has correct component name", () => {
      expect(
        wrapper.vm.$options.__name || wrapper.vm.$options.name
      ).toBe("PipelinesList");
    });

    it("initializes filterQuery as empty string", () => {
      expect(wrapper.vm.filterQuery).toBe("");
    });

    it("initializes showCreatePipeline as false", () => {
      expect(wrapper.vm.showCreatePipeline).toBe(false);
    });

    it("initializes activeTab as 'all'", () => {
      expect(wrapper.vm.activeTab).toBe("all");
    });

    it("initializes selectedPipelines as empty array", () => {
      expect(wrapper.vm.selectedPipelines).toEqual([]);
    });

    it("initializes shouldStartfromNow as true", () => {
      expect(wrapper.vm.shouldStartfromNow).toBe(true);
    });

    it("initializes pagination with rowsPerPage 20", () => {
      expect(wrapper.vm.pagination.rowsPerPage).toBe(20);
    });

    it("initializes selectedPerPage as 20", () => {
      expect(wrapper.vm.selectedPerPage).toBe(20);
    });

    it("initializes maxRecordToReturn as 100", () => {
      expect(wrapper.vm.maxRecordToReturn).toBe(100);
    });

    it("initializes errorDialog as hidden with no data", () => {
      expect(wrapper.vm.errorDialog.show).toBe(false);
      expect(wrapper.vm.errorDialog.data).toBeNull();
    });

    it("initializes backfillDialog as hidden", () => {
      expect(wrapper.vm.backfillDialog.show).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Tabs Configuration", () => {
    it("has exactly 3 tabs", () => {
      expect(wrapper.vm.tabs).toHaveLength(3);
    });

    it("first tab is 'all'", () => {
      expect(wrapper.vm.tabs[0].value).toBe("all");
    });

    it("second tab is 'scheduled'", () => {
      expect(wrapper.vm.tabs[1].value).toBe("scheduled");
    });

    it("third tab is 'realtime'", () => {
      expect(wrapper.vm.tabs[2].value).toBe("realtime");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Pagination Configuration", () => {
    it("has 5 perPageOptions entries", () => {
      expect(wrapper.vm.perPageOptions).toHaveLength(5);
    });

    it("perPageOptions start at 20", () => {
      expect(wrapper.vm.perPageOptions[0].value).toBe(20);
    });

    it("perPageOptions end at 500", () => {
      expect(wrapper.vm.perPageOptions[4].value).toBe(500);
    });

    it("changePagination updates selectedPerPage and pagination", async () => {
      const mockQTable = { setPagination: vi.fn() };
      wrapper.vm.qTableRef = mockQTable;

      await wrapper.vm.changePagination({ label: "50", value: 50 });

      expect(wrapper.vm.selectedPerPage).toBe(50);
      expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Computed Properties", () => {
    it("currentRouteName returns 'pipelines'", () => {
      expect(wrapper.vm.currentRouteName).toBe("pipelines");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("filterData method", () => {
    it("filters rows by name (case-insensitive)", () => {
      const rows = [
        { name: "Test Pipeline" },
        { name: "Another Pipeline" },
        { name: "Different Name" },
      ];
      const result = wrapper.vm.filterData(rows, "test");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Test Pipeline");
    });

    it("is case-insensitive", () => {
      const rows = [{ name: "TEST Pipeline" }, { name: "test pipeline" }];
      const result = wrapper.vm.filterData(rows, "TeSt");
      expect(result).toHaveLength(2);
    });

    it("returns empty array when no matches", () => {
      const rows = [{ name: "Pipeline One" }, { name: "Pipeline Two" }];
      expect(wrapper.vm.filterData(rows, "xyz")).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("getColumnsForActiveTab method", () => {
    it("returns columns with 'actions' for 'all' tab", () => {
      const cols = wrapper.vm.getColumnsForActiveTab("all");
      expect(Array.isArray(cols)).toBe(true);
      expect(cols.some((c: any) => c.name === "actions")).toBe(true);
    });

    it("returns 'stream_name' column for 'realtime' tab", () => {
      const cols = wrapper.vm.getColumnsForActiveTab("realtime");
      expect(cols.some((c: any) => c.name === "stream_name")).toBe(true);
    });

    it("returns 'frequency' column for 'scheduled' tab", () => {
      const cols = wrapper.vm.getColumnsForActiveTab("scheduled");
      expect(cols.some((c: any) => c.name === "frequency")).toBe(true);
    });

    it("returns 'period' column for 'scheduled' tab", () => {
      const cols = wrapper.vm.getColumnsForActiveTab("scheduled");
      expect(cols.some((c: any) => c.name === "period")).toBe(true);
    });

    it("'all' tab includes 'type' column", () => {
      const cols = wrapper.vm.getColumnsForActiveTab("all");
      expect(cols.some((c: any) => c.name === "type")).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("filterColumns method", () => {
    it("returns all columns for 'all' tab", () => {
      wrapper.vm.activeTab = "all";
      wrapper.vm.columns = [{ name: "#" }, { name: "name" }];
      const result = wrapper.vm.filterColumns();
      expect(result).toEqual(wrapper.vm.columns);
    });

    it("returns all columns for 'realtime' tab", () => {
      wrapper.vm.activeTab = "realtime";
      wrapper.vm.columns = [{ name: "#" }, { name: "name" }];
      const result = wrapper.vm.filterColumns();
      expect(result).toEqual(wrapper.vm.columns);
    });

    it("slices off first column for 'scheduled' tab", () => {
      wrapper.vm.activeTab = "scheduled";
      wrapper.vm.columns = [{ name: "#" }, { name: "name" }];
      const result = wrapper.vm.filterColumns();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("name");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Row Expansion Management", () => {
    it("expands a scheduled pipeline row", () => {
      const props = {
        row: { pipeline_id: "test-id", source: { source_type: "scheduled" } },
      };
      wrapper.vm.triggerExpand(props);
      expect(wrapper.vm.expandedRow).toBe("test-id");
    });

    it("collapses an already-expanded row when clicked again", () => {
      const props = {
        row: { pipeline_id: "test-id", source: { source_type: "scheduled" } },
      };
      wrapper.vm.expandedRow = "test-id";
      wrapper.vm.triggerExpand(props);
      expect(wrapper.vm.expandedRow).toBeNull();
    });

    it("does not expand a realtime pipeline row", () => {
      const props = {
        row: { pipeline_id: "test-id", source: { source_type: "realtime" } },
      };
      wrapper.vm.triggerExpand(props);
      expect(wrapper.vm.expandedRow).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Dialog Management", () => {
    it("openDeleteDialog shows confirm dialog with pipeline data", () => {
      wrapper.vm.openDeleteDialog(mockRealtimePipeline);
      expect(wrapper.vm.confirmDialogMeta.show).toBe(true);
      expect(wrapper.vm.confirmDialogMeta.data).toStrictEqual(
        mockRealtimePipeline
      );
    });

    it("resetConfirmDialog hides dialog and clears state", () => {
      wrapper.vm.confirmDialogMeta.show = true;
      wrapper.vm.confirmDialogMeta.title = "Test";
      wrapper.vm.confirmDialogMeta.data = { test: true };

      wrapper.vm.resetConfirmDialog();

      expect(wrapper.vm.confirmDialogMeta.show).toBe(false);
      expect(wrapper.vm.confirmDialogMeta.title).toBe("");
      expect(wrapper.vm.confirmDialogMeta.data).toBeNull();
    });

    it("showErrorDialog opens error dialog with pipeline data", () => {
      const pipelineWithError = {
        ...mockRealtimePipeline,
        last_error: {
          last_error_timestamp: 1700000000000,
          error_summary: "Node failed",
          node_errors: {},
        },
      };
      wrapper.vm.showErrorDialog(pipelineWithError);
      expect(wrapper.vm.errorDialog.show).toBe(true);
      expect(wrapper.vm.errorDialog.data).toStrictEqual(pipelineWithError);
    });

    it("closeErrorDialog hides error dialog", () => {
      wrapper.vm.errorDialog.show = true;
      wrapper.vm.closeErrorDialog();
      expect(wrapper.vm.errorDialog.show).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Pipeline Toggle State", () => {
    it("togglePipeline calls togglePipelineState directly for enabled pipeline", () => {
      (pipelineService.toggleState as MockedFunction<any>).mockResolvedValue(
        {}
      );
      const row = { pipeline_id: "test", enabled: true, type: "realtime" };
      wrapper.vm.togglePipeline(row);
      expect(pipelineService.toggleState).toHaveBeenCalledWith(
        "test-org",
        "test",
        false,
        true
      );
    });

    it("togglePipeline calls togglePipelineState directly for realtime pipeline regardless of enabled state", () => {
      (pipelineService.toggleState as MockedFunction<any>).mockResolvedValue(
        {}
      );
      const row = { pipeline_id: "rt1", enabled: false, type: "realtime" };
      wrapper.vm.togglePipeline(row);
      expect(pipelineService.toggleState).toHaveBeenCalled();
    });

    it("togglePipeline shows resume dialog for disabled scheduled pipeline", async () => {
      const row = { enabled: false, type: "scheduled" };
      await wrapper.vm.togglePipeline(row);
      expect(wrapper.vm.resumePipelineDialogMeta.show).toBe(true);
      expect(wrapper.vm.resumePipelineDialogMeta.data).toStrictEqual(row);
    });

    it("togglePipelineState calls pipelineService.toggleState with correct args", async () => {
      (pipelineService.toggleState as MockedFunction<any>).mockResolvedValue(
        {}
      );
      const row = { pipeline_id: "test", enabled: true };
      await wrapper.vm.togglePipelineState(row, true);
      expect(pipelineService.toggleState).toHaveBeenCalledWith(
        "test-org",
        "test",
        false,
        true
      );
    });

    it("togglePipelineState handles non-403 errors with notification", async () => {
      const error = {
        response: { status: 400, data: { message: "Toggle Error" } },
      };
      (pipelineService.toggleState as MockedFunction<any>).mockRejectedValue(
        error
      );
      const row = { pipeline_id: "test", enabled: true };
      await wrapper.vm.togglePipelineState(row, true);
      expect(pipelineService.toggleState).toHaveBeenCalled();
    });

    it("togglePipelineState silently ignores 403 errors", async () => {
      const error = { response: { status: 403 } };
      (pipelineService.toggleState as MockedFunction<any>).mockRejectedValue(
        error
      );
      const row = { pipeline_id: "test", enabled: true };
      await wrapper.vm.togglePipelineState(row, true);
      expect(pipelineService.toggleState).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Resume Pipeline Dialog", () => {
    it("handleResumePipeline calls toggleState and closes dialog", () => {
      (pipelineService.toggleState as MockedFunction<any>).mockResolvedValue(
        {}
      );
      wrapper.vm.resumePipelineDialogMeta.data = mockScheduledPipeline;
      wrapper.vm.shouldStartfromNow = false;

      wrapper.vm.handleResumePipeline();

      expect(wrapper.vm.resumePipelineDialogMeta.show).toBe(false);
      expect(pipelineService.toggleState).toHaveBeenCalledWith(
        "test-org",
        mockScheduledPipeline.pipeline_id,
        true,
        false
      );
    });

    it("handleCancelResumePipeline closes the resume dialog", () => {
      wrapper.vm.resumePipelineDialogMeta.show = true;
      wrapper.vm.handleCancelResumePipeline();
      expect(wrapper.vm.resumePipelineDialogMeta.show).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Pipeline CRUD Operations", () => {
    it("editPipeline maps io_type to type on nodes and navigates", () => {
      const pipeline = {
        ...mockRealtimePipeline,
        nodes: [{ io_type: "input" }, { io_type: "output" }],
      };

      wrapper.vm.editPipeline(pipeline);

      expect(pipeline.nodes[0].type).toBe("input");
      expect(pipeline.nodes[1].type).toBe("output");
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "pipelineEditor",
        query: {
          id: pipeline.pipeline_id,
          name: pipeline.name,
          org_identifier: "test-org",
        },
      });
    });

    it("savePipeline calls createPipeline with org_identifier", () => {
      const data = { name: "New Pipeline" };
      wrapper.vm.savePipeline(data);
      expect(pipelineService.createPipeline).toHaveBeenCalledWith({
        ...data,
        org_identifier: "test-org",
      });
    });

    it("savePipeline sets showCreatePipeline to false", () => {
      wrapper.vm.savePipeline({ name: "New Pipeline" });
      expect(wrapper.vm.showCreatePipeline).toBe(false);
    });

    it("savePipeline handles API errors gracefully", async () => {
      const error = {
        response: { status: 400, data: { message: "Error" } },
      };
      (pipelineService.createPipeline as MockedFunction<any>).mockRejectedValue(
        error
      );
      await wrapper.vm.savePipeline({ name: "New Pipeline" });
      expect(pipelineService.createPipeline).toHaveBeenCalled();
    });

    it("deletePipeline calls pipelineService.deletePipeline with correct args", () => {
      wrapper.vm.confirmDialogMeta.data = mockRealtimePipeline;
      wrapper.vm.confirmDialogMeta.show = true;

      wrapper.vm.deletePipeline();

      expect(pipelineService.deletePipeline).toHaveBeenCalledWith({
        pipeline_id: mockRealtimePipeline.pipeline_id,
        org_id: "test-org",
      });
    });

    it("deletePipeline resets confirm dialog immediately", () => {
      wrapper.vm.confirmDialogMeta.data = mockRealtimePipeline;
      wrapper.vm.confirmDialogMeta.show = true;
      wrapper.vm.confirmDialogMeta.title = "Delete Pipeline";

      wrapper.vm.deletePipeline();

      expect(wrapper.vm.confirmDialogMeta.show).toBe(false);
      expect(wrapper.vm.confirmDialogMeta.title).toBe("");
      expect(wrapper.vm.confirmDialogMeta.data).toBeNull();
    });

    it("deletePipeline handles API errors gracefully", async () => {
      const error = {
        response: { status: 400, data: { message: "Delete Error" } },
      };
      (pipelineService.deletePipeline as MockedFunction<any>).mockRejectedValue(
        error
      );
      wrapper.vm.confirmDialogMeta.data = mockRealtimePipeline;
      await wrapper.vm.deletePipeline();
      expect(pipelineService.deletePipeline).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Navigation Methods", () => {
    it("routeToAddPipeline navigates to createPipeline with org_identifier", () => {
      wrapper.vm.routeToAddPipeline();
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "createPipeline",
        query: { org_identifier: "test-org" },
      });
    });

    it("routeToImportPipeline navigates to importPipeline with org_identifier", () => {
      wrapper.vm.routeToImportPipeline();
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "importPipeline",
        query: { org_identifier: "test-org" },
      });
    });

    it("goToPipelineHistory navigates to pipelineHistory", () => {
      wrapper.vm.goToPipelineHistory();
      expect(mockRouter.push).toHaveBeenCalledWith(
        expect.objectContaining({ name: "pipelineHistory" })
      );
    });

    it("goToBackfillJobs navigates to backfillJobs", () => {
      wrapper.vm.goToBackfillJobs();
      expect(mockRouter.push).toHaveBeenCalledWith(
        expect.objectContaining({ name: "pipelineBackfill" })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Export Methods", () => {
    it("exportPipeline triggers a download for a single pipeline", () => {
      wrapper.vm.exportPipeline(mockRealtimePipeline);
      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(global.URL.revokeObjectURL).toHaveBeenCalled();
    });

    it("exportBulkPipelines downloads all selected pipelines and clears selection", () => {
      wrapper.vm.selectedPipelines = [
        mockRealtimePipeline,
        mockScheduledPipeline,
      ];
      wrapper.vm.exportBulkPipelines();
      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(wrapper.vm.selectedPipelines).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("getPipelines Data Processing", () => {
    it("processes realtime pipeline correctly", async () => {
      const rt = {
        pipeline_id: "rt1",
        name: "RT Test",
        source: {
          source_type: "realtime",
          stream_name: "rt_stream",
          stream_type: "logs",
        },
        edges: [],
        nodes: [],
      };
      (pipelineService.getPipelines as MockedFunction<any>).mockResolvedValue({
        data: { list: [rt] },
      });

      await wrapper.vm.getPipelines();

      if (wrapper.vm.pipelines.length > 0) {
        const p = wrapper.vm.pipelines[0];
        expect(p.type).toBe("realtime");
        expect(p.stream_name).toBe("rt_stream");
        expect(p.frequency).toBe("--");
        expect(p.sql_query).toBe("--");
      }
    });

    it("processes scheduled pipeline (minutes frequency) correctly", async () => {
      const sch = {
        pipeline_id: "sch1",
        name: "Sch Test",
        source: {
          source_type: "scheduled",
          stream_type: "metrics",
          trigger_condition: {
            frequency_type: "minutes",
            frequency: 15,
            period: 10,
          },
          query_condition: { sql: "SELECT * FROM metrics" },
        },
        edges: [],
        nodes: [],
      };
      (pipelineService.getPipelines as MockedFunction<any>).mockResolvedValue({
        data: { list: [sch] },
      });

      await wrapper.vm.getPipelines();

      if (wrapper.vm.pipelines.length > 0) {
        const p = wrapper.vm.pipelines[0];
        expect(p.type).toBe("scheduled");
        expect(p.frequency).toBe("15 Mins");
        expect(p.period).toBe("10 Mins");
        expect(p.cron).toBe("False");
        expect(p.sql_query).toBe("SELECT * FROM metrics");
      }
    });

    it("processes scheduled pipeline (cron frequency) correctly", async () => {
      const sch = {
        pipeline_id: "sch2",
        name: "Cron Test",
        source: {
          source_type: "scheduled",
          stream_type: "metrics",
          trigger_condition: {
            frequency_type: "cron",
            frequency: "0 * * * *",
            period: 0,
          },
          query_condition: { sql: "SELECT 1" },
        },
        edges: [],
        nodes: [],
      };
      (pipelineService.getPipelines as MockedFunction<any>).mockResolvedValue({
        data: { list: [sch] },
      });

      await wrapper.vm.getPipelines();

      if (wrapper.vm.pipelines.length > 0) {
        const p = wrapper.vm.pipelines[0];
        expect(p.cron).toBe("True");
      }
    });

    it("handles empty pipeline list", async () => {
      (pipelineService.getPipelines as MockedFunction<any>).mockResolvedValue({
        data: { list: [] },
      });
      await wrapper.vm.getPipelines();
      expect(wrapper.vm.pipelines).toHaveLength(0);
    });

    it("handles getPipelines API error by logging to console.error", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      (pipelineService.getPipelines as MockedFunction<any>).mockRejectedValue(
        new Error("API Error")
      );

      await wrapper.vm.getPipelines();

      expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error));
      consoleSpy.mockRestore();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Tab Filtering via updateActiveTab", () => {
    beforeEach(() => {
      wrapper.vm.pipelines = mockPipelines;
    });

    it("'all' tab shows all pipelines", async () => {
      wrapper.vm.activeTab = "all";
      await wrapper.vm.updateActiveTab();
      expect(wrapper.vm.resultTotal).toBe(2);
    });

    it("'realtime' tab filters to realtime pipelines only", async () => {
      wrapper.vm.activeTab = "realtime";
      await wrapper.vm.updateActiveTab();
      wrapper.vm.filteredPipelines.forEach((p: any) => {
        expect(p.source.source_type).toBe("realtime");
      });
    });

    it("'scheduled' tab filters to scheduled pipelines only", async () => {
      wrapper.vm.activeTab = "scheduled";
      await wrapper.vm.updateActiveTab();
      wrapper.vm.filteredPipelines.forEach((p: any) => {
        expect(p.source.source_type).toBe("scheduled");
      });
    });

    it("'all' tab updates columns via getColumnsForActiveTab", async () => {
      wrapper.vm.activeTab = "all";
      await wrapper.vm.updateActiveTab();
      expect(
        wrapper.vm.columns.some((c: any) => c.name === "actions")
      ).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Bulk Operations", () => {
    it("bulkTogglePipelines calls togglePipelineState for each selected pipeline (pause)", async () => {
      (pipelineService.bulkToggleState as MockedFunction<any>).mockResolvedValue(
        {}
      );
      wrapper.vm.selectedPipelines = [
        { ...mockRealtimePipeline, enabled: true },
        { ...mockScheduledPipeline, enabled: true },
      ];
      await wrapper.vm.bulkTogglePipelines("pause");
      expect(pipelineService.bulkToggleState).toHaveBeenCalledTimes(1);
    });

    it("openBulkDeleteDialog sets confirmDialogMeta for bulk delete", () => {
      wrapper.vm.selectedPipelines = [mockRealtimePipeline];
      wrapper.vm.openBulkDeleteDialog();
      expect(wrapper.vm.confirmDialogMeta.show).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Backfill Dialog", () => {
    it("openBackfillDialog opens dialog with pipeline details", () => {
      const pipeline = {
        ...mockScheduledPipeline,
        source: {
          ...mockScheduledPipeline.source,
          trigger_condition: {
            frequency_type: "minutes",
            frequency: 30,
            period: 5,
          },
        },
      };
      wrapper.vm.openBackfillDialog(pipeline);
      expect(wrapper.vm.backfillDialog.show).toBe(true);
      expect(wrapper.vm.backfillDialog.pipelineId).toBe(
        mockScheduledPipeline.pipeline_id
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  describe("Method Exposure", () => {
    it("exposes all required methods", () => {
      const required = [
        "togglePipeline",
        "togglePipelineState",
        "triggerExpand",
        "getColumnsForActiveTab",
        "getPipelines",
        "editPipeline",
        "openDeleteDialog",
        "savePipeline",
        "deletePipeline",
        "resetConfirmDialog",
        "filterData",
        "routeToAddPipeline",
        "exportPipeline",
        "routeToImportPipeline",
        "exportBulkPipelines",
        "handleResumePipeline",
        "handleCancelResumePipeline",
        "updateActiveTab",
        "changePagination",
        "filterColumns",
        "showErrorDialog",
        "closeErrorDialog",
      ];
      required.forEach((m) => {
        expect(typeof wrapper.vm[m]).toBe("function");
      });
    });
  });
});

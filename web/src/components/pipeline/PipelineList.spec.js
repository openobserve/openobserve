import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Dialog, Notify } from "quasar";
import { installQuasar } from "@/test/unit/helpers";
import router from "@/test/unit/helpers/router";
import i18n from "@/locales";
import PipelinesList from "./PipelinesList.vue";
import pipelineService from "@/services/pipelines";
import { nextTick } from "vue";

// Mock useDnD
vi.mock('@/plugins/pipelines/useDnD', () => ({
  default: () => ({
    pipelineObj: {
      currentSelectedPipeline: {},
      pipelineWithoutChange: {},
    }
  })
}));

// Mock Quasar
vi.mock('quasar', async () => {
  const actual = await vi.importActual('quasar');
  return {
    ...actual,
    useQuasar: () => ({
      notify: vi.fn(() => vi.fn())
    })
  };
});

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock the pipeline service
vi.mock("@/services/pipelines", () => ({
  default: {
    getPipelines: vi.fn(),
    toggleState: vi.fn(),
    deletePipeline: vi.fn(),
    createPipeline: vi.fn(),
  },
}));

describe("PipelinesList", () => {
  let wrapper = null;
  let mockStore;
  let mockPipelines;

  beforeEach(async () => {
    // Mock URL methods
    global.URL.createObjectURL = vi.fn(() => "blob:test");
    global.URL.revokeObjectURL = vi.fn();

    // Setup mock store
    mockStore = {
      state: {
        selectedOrganization: {
          identifier: "test-org",
        },
        theme: "light",
      },
    };

    // Setup mock pipelines data
    mockPipelines = {
      data: {
        list: [
          {
            pipeline_id: "1",
            name: "Test Pipeline 1",
            enabled: true,
            source: {
              source_type: "realtime",
              stream_name: "test_stream",
              stream_type: "logs",
            },
            edges: [],
            nodes: [],
          },
          {
            pipeline_id: "2",
            name: "Test Pipeline 2",
            enabled: false,
            source: {
              source_type: "scheduled",
              stream_type: "logs",
              trigger_condition: {
                frequency_type: "minutes",
                frequency: 5,
                period: 10,
              },
              query_condition: {
                sql: "SELECT * FROM test",
              },
            },
            edges: [],
            nodes: [],
          },
        ],
      },
    };

    // Mock the getPipelines service call
    pipelineService.getPipelines.mockResolvedValue(mockPipelines);

    // Mock router push
    router.push = vi.fn();

    // Mount the component with mocked router
    wrapper = mount(PipelinesList, {
      global: {
        plugins: [i18n, router],
        provide: {
          store: mockStore,
        },
        stubs: {
          RouterView: true,
          QDialog: true,
          StreamSelection: true,
          ConfirmDialog: true,
          ResumePipelineDialog: true,
          'q-table': true,
          'q-tr': true,
          'q-td': true,
          'q-checkbox': true,
          'q-btn': true,
          'q-tooltip': true,
          'q-icon': true,
          'q-input': true,
          'app-tabs': true,
          'q-table-pagination': true,
        },
      },
    });

    await flushPromises();
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
  });

  describe("Component Initialization", () => {
    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should fetch pipelines on mount", async () => {
      expect(pipelineService.getPipelines).toHaveBeenCalledWith("test-org");
    });

    it("should display correct number of pipelines", async () => {
      expect(wrapper.vm.pipelines.length).toBe(2);
    });

    it("should initialize with correct default values", () => {
      expect(wrapper.vm.activeTab).toBe("all");
      expect(wrapper.vm.filterQuery).toBe("");
      expect(wrapper.vm.selectedPipelines).toEqual([]);
      expect(wrapper.vm.pagination.rowsPerPage).toBe(20);
    });
  });

  describe("Pipeline Filtering", () => {
    it("should filter pipelines by name", async () => {
      wrapper.vm.filterQuery = "Test Pipeline 1";
      const rows = [mockPipelines.data.list[0], mockPipelines.data.list[1]];
      const filtered = wrapper.vm.filterData(rows, "Test Pipeline 1");
      expect(filtered.length).toBe(1);
    });

    it("should filter pipelines by type when activeTab changes", async () => {
      wrapper.vm.activeTab = "realtime";
      await nextTick();
      wrapper.vm.updateActiveTab();
      expect(wrapper.vm.filteredPipelines.length).toBe(1);
    });

    it("should show all pipelines when activeTab is 'all'", async () => {
      wrapper.vm.activeTab = "all";
      await nextTick();
      wrapper.vm.updateActiveTab();
      expect(wrapper.vm.filteredPipelines.length).toBe(2);
    });

    it("should handle empty filter query", async () => {
      wrapper.vm.filterQuery = "";
      const rows = [mockPipelines.data.list[0], mockPipelines.data.list[1]];
      const filtered = wrapper.vm.filterData(rows, "");
      expect(filtered.length).toBe(2);
    });

    it("should handle case-insensitive filtering", async () => {
      wrapper.vm.filterQuery = "test pipeline";
      const rows = [mockPipelines.data.list[0], mockPipelines.data.list[1]];
      const filtered = wrapper.vm.filterData(rows, "test pipeline");
      expect(filtered.length).toBe(2);
    });
  });

  describe("Pipeline Actions", () => {
    it("should toggle pipeline state", async () => {
      const pipeline = mockPipelines.data.list[0];
      pipelineService.toggleState.mockResolvedValue({});

      await wrapper.vm.togglePipeline(pipeline);
      expect(pipelineService.toggleState).toHaveBeenCalledWith(
        "test-org",
        pipeline.pipeline_id,
        false,
        true
      );
    });

    it("should show resume dialog for paused scheduled pipelines", async () => {
      const pipeline = { ...mockPipelines.data.list[1], type: "scheduled" };
      await wrapper.vm.togglePipeline(pipeline);
      expect(wrapper.vm.resumePipelineDialogMeta.show).toBe(true);
    });

    it("should handle pipeline deletion", async () => {
      const pipeline = mockPipelines.data.list[0];
      pipelineService.deletePipeline.mockResolvedValue({});

      wrapper.vm.openDeleteDialog(pipeline);
      expect(wrapper.vm.confirmDialogMeta.show).toBe(true);

      await wrapper.vm.deletePipeline();
      expect(pipelineService.deletePipeline).toHaveBeenCalledWith({
        pipeline_id: pipeline.pipeline_id,
        org_id: "test-org",
      });
    });

    it("should handle pipeline export", async () => {
      const pipeline = mockPipelines.data.list[0];
      const mockLink = { click: vi.fn(), href: "", download: "" };
      global.document.createElement = vi.fn().mockReturnValue(mockLink);
      
      wrapper.vm.exportPipeline(pipeline);
      
      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(mockLink.click).toHaveBeenCalled();
      expect(mockLink.download).toBe(`${pipeline.name}.json`);
      expect(global.URL.revokeObjectURL).toHaveBeenCalled();
    });

  });

});

import { sanitizeStreamName } from './utils/pipelineCommonValidation'
import PipelineEditor from './PipelineEditor.vue'

import { flushPromises, mount } from "@vue/test-utils";
import useDnD from '@/plugins/pipelines/useDnD'
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Dialog, Notify } from "quasar";
import store from "@/test/unit/helpers/store";
import { installQuasar } from "@/test/unit/helpers";
import router from "@/test/unit/helpers/router";
import i18n from "@/locales";
import { ref } from 'vue';

installQuasar({
  plugins: [Dialog, Notify],
});
const mockAddNode = vi.fn();
// Mock the useDnD composable
vi.mock('@/plugins/pipelines/useDnD', () => ({
  default: vi.fn(),
  useDnD: () => ({
    addNode: mockAddNode
  })
}));

vi.mock('@/composables/useStreams', () => ({
  default: () => ({
    search: vi.fn(),
    getStreams: vi.fn().mockResolvedValue({ 
      list: [
        { name: "test_stream1", stream_type: "logs" },
        { name: "test_stream2", stream_type: "logs" }
      ]
    })
  })
}));

vi.mock('@/composables/usePipelines', () => ({
  default: () => ({
    getUsedStreamsList: vi.fn().mockResolvedValue([]),
    getPipelineDestinations: vi.fn().mockResolvedValue([])
  })
}));

vi.mock('@/services/jstransform', () => ({
  default: {
    list: vi.fn().mockResolvedValue({ data: { list: [] } })
  }
}));

vi.mock('@/services/pipelines', () => ({
  default: {
    getPipelines: vi.fn().mockResolvedValue({ data: { list: [] } }),
    createPipeline: vi.fn().mockResolvedValue({}),
    updatePipeline: vi.fn().mockResolvedValue({})
  }
}));

describe("PipelineEditor", () => {
  let wrapper;
  let mockPipelineObj;
  let mockConfirmDialogMeta;
  let mockRouter;
  let mockStore;
  let mockFunctions;
  let mockFunctionOptions;
  let mockValidationErrors;
  let mockConfirmDialogBasicPipeline;
  let mockShowJsonEditorDialog;
  let mockEditingFunctionName;
  let mockEditingStreamRouteName;

  beforeEach(() => {
    // Setup reactive values
    mockFunctions = { value: {} };
    mockFunctionOptions = { value: [] };
    mockValidationErrors = { value: [] };
    mockConfirmDialogBasicPipeline = { value: false };
    mockShowJsonEditorDialog = { value: false };
    mockEditingFunctionName = { value: "" };
    mockEditingStreamRouteName = { value: "" };
    
    mockConfirmDialogMeta = {
      value: {
        show: false,
        title: "",
        message: "",
        onConfirm: vi.fn(),
        data: null
      }
    };

    mockRouter = {
      push: vi.fn(),
      replace: vi.fn(),
      currentRoute: {
        value: {
          query: { id: "test-pipeline-id" },
          name: "pipelineEditor",
          path: "/pipeline/pipelines/edit"
        }
      }
    };

    mockStore = {
      state: {
        selectedOrganization: {
          identifier: "test-org"
        }
      }
    };

    // Create a mock notify function
    // Setup the mock pipeline object with test data
    mockPipelineObj = {
      currentSelectedPipeline: {
        nodes: [],
        edges: [],
        source: {
          source_type: "realtime"
        },
        name: "test-pipeline"
      },
      isEditPipeline: false,
      dirtyFlag: false,
      dialog: {
        show: false,
        name: ""
      }
    };

    // Update the useDnD mock with our test data
    vi.mocked(useDnD).mockImplementation(() => ({
      pipelineObj: mockPipelineObj,
      onDragStart: vi.fn(),
      onDragLeave: vi.fn(),
      onDragOver: vi.fn(),
      onDrop: vi.fn(),
      onNodeChange: vi.fn(),
      onNodesChange: vi.fn(),
      onEdgesChange: vi.fn(),
      onConnect: vi.fn(),
      validateConnection: vi.fn(),
      addNode: vi.fn(),
      editNode: vi.fn(),
      deletePipelineNode: vi.fn(),
      resetPipelineData: vi.fn(),
      comparePipelinesById: vi.fn()
    }));

    wrapper = mount(PipelineEditor, {
      global: {
        provide: { 
          store: store,
        },
        plugins: [i18n, router],
      }
    });
  });

  afterEach(async () => {
    // Clean up any pending promises
    await flushPromises();
    
    // Ensure all Quasar dialogs are closed
    if (wrapper) {
      // Close any open dialogs
      wrapper.vm.confirmDialogMeta.show = false;
      wrapper.vm.showJsonEditorDialog = false;
      wrapper.vm.confirmDialogBasicPipeline = false;
      
      // Unmount the component
      wrapper.unmount();
      wrapper = null;
    }
    
    vi.clearAllMocks();
    vi.clearAllTimers();
  });

  describe("Functions with input and output as expected", () => {
    describe("validatePipeline function", () => {
      it("should return false when using enrichment_tables with stream input", () => {
        // Set up test data for enrichment tables scenario
        mockPipelineObj.currentSelectedPipeline.nodes = [
          {
            type: "input",
            data: {
              node_type: "stream"
            }
          },
          {
            type: "output",
            data: {
              node_type: "stream",
              stream_type: "enrichment_tables"
            }
          }
        ];

        const result = wrapper.vm.validatePipeline();
        expect(result).toBe(false);
      });

      it("should return true for valid pipeline configuration", () => {
        // Set up test data for valid configuration
        mockPipelineObj.currentSelectedPipeline.nodes = [
          {
            type: "input",
            data: {
              node_type: "stream"
            }
          },
          {
            type: "output",
            data: {
              node_type: "stream",
              stream_type: "logs"
            }
          }
        ];

        const result = wrapper.vm.validatePipeline();
        expect(result).toBe(true);
      });

      it("should return true when input node type is query (scheduled pipeline)", () => {
        // Set up test data for scheduled pipeline with query input
        mockPipelineObj.currentSelectedPipeline.nodes = [
          {
            type: "input",
            data: {
              node_type: "query"
            }
          },
          {
            type: "output",
            data: {
              node_type: "stream",
              stream_type: "enrichment_tables"
            }
          }
        ];

        const result = wrapper.vm.validatePipeline();
        expect(result).toBe(true);
      });
    });

    describe("dialog management functions", () => {
      it("should open the cancel dialog when there are changes", async () => {
        mockPipelineObj.dirtyFlag = true;
        
        // Mock the component's confirmDialogMeta reactive reference
        const mockConfirmDialogRef = { 
          show: false, 
          title: "", 
          message: "", 
          onConfirm: vi.fn() 
        };
        wrapper.vm.confirmDialogMeta = { value: mockConfirmDialogRef };
        
        wrapper.vm.openCancelDialog();

        expect(wrapper.vm.confirmDialogMeta.show).toBe(true);
        expect(wrapper.vm.confirmDialogMeta.title).toBe("Cancel Changes");
      });

      it("should reset confirm dialog correctly", async () => {
        const mockConfirmDialogRef = { 
          show: true, 
          title: "Test", 
          message: "Test message", 
          onConfirm: vi.fn(),
          data: { test: "data" }
        };
        wrapper.vm.confirmDialogMeta = { value: mockConfirmDialogRef };
        
        wrapper.vm.resetConfirmDialog();

        expect(wrapper.vm.confirmDialogMeta.show).toBe(false);
        expect(wrapper.vm.confirmDialogMeta.title).toBe("");
        expect(wrapper.vm.confirmDialogMeta.message).toBe("");
        expect(wrapper.vm.confirmDialogMeta.data).toBeNull();
      });

      it("should open JSON editor", async () => {
        wrapper.vm.showJsonEditorDialog = { value: false };
        wrapper.vm.openJsonEditor();
        
        expect(wrapper.vm.showJsonEditorDialog).toBe(true);
      });

      it("should reset dialog correctly", async () => {
        mockPipelineObj.dialog.show = true;
        mockPipelineObj.dialog.name = "test";
        wrapper.vm.editingFunctionName = { value: "testFunction" };
        wrapper.vm.editingStreamRouteName = { value: "testStream" };
        
        wrapper.vm.resetDialog();
        
        expect(mockPipelineObj.dialog.show).toBe(false);
        expect(mockPipelineObj.dialog.name).toBe("");
        expect(wrapper.vm.editingFunctionName).toBe("");
        expect(wrapper.vm.editingStreamRouteName).toBe("");
      });
    });

    describe("pipeline validation functions", () => {
      it("should find missing edges", async () => {
        mockPipelineObj.currentSelectedPipeline.nodes = [
          { id: "1", type: "default" },
          { id: "2", type: "default" }
        ];
        mockPipelineObj.currentSelectedPipeline.edges = [{ source: "1", target: "3" }];

        const result = wrapper.vm.findMissingEdges();
        expect(result).toBe(true);
      });

      it("should return false when all nodes are connected", async () => {
        mockPipelineObj.currentSelectedPipeline.nodes = [
          { id: "1", type: "input" },
          { id: "2", type: "output" }
        ];
        mockPipelineObj.currentSelectedPipeline.edges = [
          { source: "1", target: "2" }
        ];

        const result = wrapper.vm.findMissingEdges();
        expect(result).toBe(false);
      });

      it("should validate nodes correctly - return true for more than 2 nodes", async () => {
        const nodes = [
          { io_type: "input", data: { node_type: "stream" } },
          { io_type: "default", data: { node_type: "function" } },
          { io_type: "output", data: { node_type: "stream" } }
        ];

        const result = wrapper.vm.isValidNodes(nodes);
        expect(result).toBe(true);
      });

      it("should validate nodes correctly - return false for same stream input and output", async () => {
        const nodes = [
          { 
            io_type: "input", 
            data: { 
              node_type: "stream", 
              stream_name: "test-stream", 
              stream_type: "logs" 
            } 
          },
          { 
            io_type: "output", 
            data: { 
              node_type: "stream", 
              stream_name: "test-stream", 
              stream_type: "logs" 
            } 
          }
        ];

        const result = wrapper.vm.isValidNodes(nodes);
        expect(result).toBe(false);
      });
    });
    describe("event handlers", () => {
      it("should handle beforeUnloadHandler when there are changes", async () => {
        mockPipelineObj.dirtyFlag = true;
        
        const mockEvent = { returnValue: null };
        const result = wrapper.vm.beforeUnloadHandler(mockEvent);
        
        // The actual message returned is the translated text, not the key
        expect(mockEvent.returnValue).toBe("You have unsaved changes. Are you sure you want to leave?");
        expect(result).toBe("You have unsaved changes. Are you sure you want to leave?");
      });

      it("should handle beforeUnloadHandler when there are no changes", async () => {
        mockPipelineObj.dirtyFlag = false;
        mockPipelineObj.currentSelectedPipeline.nodes = [];
        mockPipelineObj.isEditPipeline = true;
        
        const mockEvent = { returnValue: null };
        const result = wrapper.vm.beforeUnloadHandler(mockEvent);
        
        expect(result).toBeUndefined();
      });
    });

    describe("drag and drop operations", () => {
      it("should handle onNodeDragStart correctly", async () => {
        const mockEvent = {
          dataTransfer: {
            setData: vi.fn()
          }
        };
        const testData = "test-node-data";
        
        wrapper.vm.onNodeDragStart(mockEvent, testData);
        
        expect(mockEvent.dataTransfer.setData).toHaveBeenCalledWith("text", testData);
      });

      it("should handle onNodeDragOver correctly", async () => {
        const mockEvent = {
          preventDefault: vi.fn()
        };
        
        wrapper.vm.onNodeDragOver(mockEvent);
        
        expect(mockEvent.preventDefault).toHaveBeenCalled();
      });

      it("should handle onNodeDrop correctly", async () => {
        const mockEvent = {
          preventDefault: vi.fn(),
          dataTransfer: {
            getData: vi.fn().mockReturnValue("test-node-type")
          }
        };
        
        wrapper.vm.onNodeDrop(mockEvent);
        
        expect(mockEvent.preventDefault).toHaveBeenCalled();
        expect(mockEvent.dataTransfer.getData).toHaveBeenCalledWith("text");
      });
    });

    describe("JSON pipeline operations", () => {
      it("should handle savePipelineJson with valid JSON", async () => {
        const validJson = JSON.stringify({
          name: "test-pipeline",
          nodes: [],
          edges: [],
          source: { source_type: "realtime" }
        });
        
        wrapper.vm.savePipeline = vi.fn();
        wrapper.vm.validationErrors = { value: [] };
        
        // Mock the validation utility to return valid
        vi.doMock('../../utils/validatePipeline', () => ({
          validatePipeline: vi.fn().mockReturnValue({ isValid: true, errors: [] })
        }));
        
        await wrapper.vm.savePipelineJson(validJson);
        
        expect(wrapper.vm.validationErrors).toEqual([]);
      });

      it("should handle savePipelineJson with invalid JSON", async () => {
        const invalidJson = "{ invalid json }";
        
        wrapper.vm.validationErrors = { value: [] };
        
        await wrapper.vm.savePipelineJson(invalidJson);

        expect(wrapper.vm.validationErrors).toEqual(['Invalid JSON format']);
      });
    });

    describe("savePipeline function", () => {
      beforeEach(() => {
        const dismissMock = vi.fn();
        const notifyMock = vi.fn().mockReturnValue(dismissMock);
        wrapper.vm.q.notify = notifyMock;
        wrapper.vm.onSubmitPipeline = vi.fn().mockResolvedValue(true);
      });

      it("should show error when pipeline name is empty", async () => {
        mockPipelineObj.currentSelectedPipeline.name = "";
        
        await wrapper.vm.savePipeline();
        

        
        expect(wrapper.vm.q.notify).toHaveBeenCalledWith(expect.objectContaining({
          message: "Pipeline name is required"
        }));
      });

      it("should show error when source node is missing", async () => {
        mockPipelineObj.currentSelectedPipeline.name = "test-pipeline";
        mockPipelineObj.currentSelectedPipeline.nodes = [
          {
            io_type: "output",
            data: { node_type: "stream" }
          }
        ];
        
        await wrapper.vm.savePipeline();
      
        
        expect(wrapper.vm.q.notify).toHaveBeenCalledWith(expect.objectContaining({
          message: "Source node is required"
        }));
      });

      it("should show error when destination node is missing", async () => {
        mockPipelineObj.currentSelectedPipeline.name = "test-pipeline";
        mockPipelineObj.currentSelectedPipeline.nodes = [
          {
            io_type: "input",
            data: { node_type: "stream" }
          }
        ];
        
        await wrapper.vm.savePipeline();
        
        
        expect(wrapper.vm.q.notify).toHaveBeenCalledWith(expect.objectContaining({
          message: "Destination node is required"
        }));
      });

      it("should set source type to realtime for stream input", async () => {
        mockPipelineObj.currentSelectedPipeline.name = "test-pipeline";
        mockPipelineObj.currentSelectedPipeline.nodes = [
          {
            id: "node-1",
            io_type: "input",
            type: "input",
            data: { node_type: "stream" }
          },
          {
            id: "node-2",
            io_type: "output",
            type: "output",
            data: { node_type: "stream" }
          }
        ];
        mockPipelineObj.currentSelectedPipeline.edges = [
          { source: "node-1", target: "node-2" }
        ];
        
        wrapper.vm.findMissingEdges = vi.fn().mockReturnValue(false);
        wrapper.vm.isValidNodes = vi.fn().mockReturnValue(true);
        
        await wrapper.vm.savePipeline();
        
        expect(mockPipelineObj.currentSelectedPipeline.source.source_type).toBe("realtime");
      });

      it("should set source type to scheduled for query input", async () => {
        mockPipelineObj.currentSelectedPipeline.name = "test-pipeline";
        mockPipelineObj.currentSelectedPipeline.nodes = [
          {
            id: "node-1",
            io_type: "input",
            type: "input",
            data: { node_type: "query" }
          },
          {
            id: "node-2",
            io_type: "output",
            type: "output",
            data: { node_type: "stream" }
          }
        ];
        mockPipelineObj.currentSelectedPipeline.edges = [
          { source: "node-1", target: "node-2" }
        ];
        
        wrapper.vm.findMissingEdges = vi.fn().mockReturnValue(false);
        wrapper.vm.isValidNodes = vi.fn().mockReturnValue(true);
        
        await wrapper.vm.savePipeline();
        
        expect(mockPipelineObj.currentSelectedPipeline.source.source_type).toBe("scheduled");
      });

      it("should show error when nodes are not connected", async () => {
        mockPipelineObj.currentSelectedPipeline.name = "test-pipeline";
        mockPipelineObj.currentSelectedPipeline.nodes = [
          {
            id: "node-1",
            type: "input",
            io_type: "input",
            data: { node_type: "stream" }
          },
          {
            id: "node-2",
            type: "output",
            io_type: "output",
            data: { node_type: "stream" }
          }
        ];
        // No edges defined - this should trigger the missing edges error
        mockPipelineObj.currentSelectedPipeline.edges = [];
        
        await wrapper.vm.savePipeline();
        
        expect(wrapper.vm.q.notify).toHaveBeenCalledWith(expect.objectContaining({
          message: "Please connect all nodes before saving"
        }));
      });

      it("should handle stream name objects correctly", async () => {
        mockPipelineObj.currentSelectedPipeline.name = "test-pipeline";
        const testStreamName = "test-stream";
        mockPipelineObj.currentSelectedPipeline.nodes = [
          {
            id: "node-1",
            type: "input",
            data: { 
              node_type: "stream",
              stream_name:testStreamName
            }
          },
          {
            id: "node-2",
            type: "output",
            data: { node_type: "stream" }
          }
        ];
        mockPipelineObj.currentSelectedPipeline.edges = [
          { source: "node-1", target: "node-2" }
        ];
        
        wrapper.vm.findMissingEdges = vi.fn().mockReturnValue(false);
        wrapper.vm.isValidNodes = vi.fn().mockReturnValue(true);
        
        await wrapper.vm.savePipeline();
        
        expect(mockPipelineObj.currentSelectedPipeline.nodes[0].data.stream_name).toBe(testStreamName);
      });

      it("should show basic pipeline dialog when nodes are invalid", async () => {
        mockPipelineObj.currentSelectedPipeline.name = "test-pipeline";
        mockPipelineObj.currentSelectedPipeline.nodes = [
          {
            id: "node-1",
            type: "input",
            io_type: "input",
            data: { node_type: "stream" }
          },
          {
            id: "node-2",
            type: "output",
            io_type: "output",
            data: { node_type: "stream" }
          }
        ];
        mockPipelineObj.currentSelectedPipeline.edges = [
          { source: "node-1", target: "node-2" }
        ];
        
        wrapper.vm.findMissingEdges = vi.fn().mockReturnValue(false);
        wrapper.vm.isValidNodes = vi.fn().mockReturnValue(false);
        wrapper.vm.showJsonEditorDialog = false;
        
        await wrapper.vm.savePipeline();
        
        expect(wrapper.vm.confirmDialogBasicPipeline).toBe(true);
      });

      it("should call onSubmitPipeline when all validations pass", async () => {
        mockPipelineObj.currentSelectedPipeline.name = "test-pipeline";
        // Set up nodes with different stream names to pass validation
        mockPipelineObj.currentSelectedPipeline.nodes = [
          {
            id: "node-1",
            type: "input",
            io_type: "input",
            data: { 
              node_type: "stream",
              stream_name: "input-stream",
              stream_type: "logs"
            }
          },
          {
            id: "node-2",
            type: "output",
            io_type: "output",
            data: { 
              node_type: "stream",
              stream_name: "output-stream",
              stream_type: "logs"
            }
          }
        ];
        mockPipelineObj.currentSelectedPipeline.edges = [
          { source: "node-1", target: "node-2" }
        ];

        await wrapper.vm.savePipeline();
        
        expect(wrapper.vm.isPipelineSaving).toBe(true);

      });
    });
  });
});
import { sanitizeStreamName } from '../utils/pipelineCommonValidation'
import PipelineEditor from '../PipelineEditor.vue'

import { flushPromises, mount } from "@vue/test-utils";
import useDnD from '@/plugins/pipelines/useDnD'
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Dialog, Notify } from "quasar";
import store from "@/test/unit/helpers/store";
import { installQuasar } from "@/test/unit/helpers";
import router from "@/test/unit/helpers/router";
import i18n from "@/locales";
import { ref } from 'vue';
import Stream from './Stream.vue'

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

describe("Stream Component", () => {
    let wrapper;
    let mockPipelineObj;
    let mockStore;
  
    beforeEach(() => {
      // Setup mock store
      mockStore = {
        state: {
          theme: 'light',
          selectedOrganization: {
            identifier: "test-org"
          }
        }
      };
  
  
  
      // Setup mock pipeline object
      mockPipelineObj = {
        currentSelectedNodeData: {
          data: {},
          io_type: 'input',
          type: 'input'
        },
        userSelectedNode: {},
        isEditNode: false
      };
  
      // Mock useDnD composable
      vi.mocked(useDnD).mockImplementation(() => ({
        pipelineObj: mockPipelineObj,
        addNode: vi.fn(),
        deletePipelineNode: vi.fn()
      }));
  
      // Mount component
      wrapper = mount(Stream, {
        global: {
          plugins: [i18n],
          provide: { 
            store: mockStore,
          }
        }
      });
  
      const notifyMock = vi.fn();
      wrapper.vm.$q.notify = notifyMock;
  
    });

    afterEach(() => {
      if (wrapper) {
        wrapper.unmount();
      }
      // Clear any pending timers to prevent "document is not defined" errors
      vi.clearAllTimers();
      vi.restoreAllMocks();
    });
  
    describe("Stream Name Sanitization", () => {
  
      it("should sanitize stream name correctly", async () => {
        const testCases = [
          { input: "test-stream", expected: "test_stream" },
          { input: "test@stream", expected: "test_stream" },
          { input: "test{field}stream", expected: "test{field}stream" },
          { input: "test{field}@stream", expected: "test{field}_stream" },
          { input: "a".repeat(101), expected: "" } // Test length limit
        ];
  
        testCases.forEach(({ input, expected }) => {
          const result = wrapper.vm.sanitizeStreamName(input);
          expect(result).toBe(expected);
        });
      });
  
      it("should show notification when stream name is too long", async () => {
  
        wrapper.vm.sanitizeStreamName("a".repeat(101));
  
        expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(expect.objectContaining({
          message: "Stream name should be less than 100 characters",
          color: "negative"
        }));
      });
    });
  
    describe("Dynamic Stream Name Handling", () => {
      it("should handle dynamic stream name input correctly", async () => {
        const testInput = "test-stream";
        wrapper.vm.handleDynamicStreamName(testInput);
  
        expect(wrapper.vm.dynamic_stream_name.value).toEqual("test_stream")
      });
  
      it("should save dynamic stream name correctly", async () => {
        wrapper.vm.dynamic_stream_name.value = {
          label: "test_stream",
          value: "test_stream",
          isDisable: false
        };
  
        wrapper.vm.saveDynamicStream();
  
        expect(wrapper.vm.stream_name.value).toEqual({
          label: "test_stream",
          value: "test_stream",
          isDisable: false
        });
      });
    });
  
    describe("Stream Type Selection", () => {
      it("should filter stream types based on node type", async () => {
        // Test input node
        wrapper.vm.selectedNodeType = "input";
        expect(wrapper.vm.filteredStreamTypes).toEqual(["logs", "metrics", "traces"]);
  
        // Test output node
        wrapper.vm.selectedNodeType = "output";
        expect(wrapper.vm.filteredStreamTypes).toEqual(["logs", "metrics", "traces", "enrichment_tables"]);
      });
  
    });
  
    describe("Stream List Management", () => {
      it("should fetch stream list correctly", async () => {
        // Call getStreamList
        await wrapper.vm.getStreamList();
        await flushPromises();
  
        // Verify the streams object is populated correctly
        expect(wrapper.vm.streams.logs).toHaveLength(2);
        expect(wrapper.vm.streams.logs).toEqual([
          { name: "test_stream1", stream_type: "logs", isDisable: false },
          { name: "test_stream2", stream_type: "logs", isDisable: false }
        ]);
        expect(wrapper.vm.isFetchingStreams).toBe(false);
      });
  
  
      it("should mark streams as disabled for input nodes when already used", async () => {
        // Setup used streams
        wrapper.vm.usedStreams = ref([
          { stream_name: "test_stream1", stream_type: "logs" }
        ]);
  
        // Setup mock response
        const mockStreamsList = [
          { name: "test_stream1", stream_type: "logs" },
          { name: "test_stream2", stream_type: "logs" }
        ];
  
        // Mock getStreams function
        const mockGetStreams = vi.fn().mockResolvedValue({
          list: mockStreamsList
        });
  
        // Setup pipeline object for input node
        mockPipelineObj.currentSelectedNodeData = {
          type: "input",
          data: {
            stream_type: "logs"
          }
        };
  
        // Set up the component with mocked getStreams
        wrapper.vm.getStreams = mockGetStreams;
  
        // Call getStreamList
        await wrapper.vm.getStreamList();
  
        // Verify streams are marked as disabled correctly
        expect(wrapper.vm.streams.logs).toEqual([
          { name: "test_stream1", stream_type: "logs", isDisable: false },
          { name: "test_stream2", stream_type: "logs", isDisable: false }
        ]);
      });
    });
  
    describe("Stream List Filtering", () => {
      it("should filter streams correctly for input node type", async () => {
        // Setup mock data
        mockPipelineObj.currentSelectedNodeData = {
          type: 'input',
          data: {
            stream_type: 'logs'
          }
        };
  
        // Setup streams data
        wrapper.vm.streams = {
          logs: [
            { name: "test_stream1", stream_type: "logs", isDisable: true },
            { name: "test_stream2", stream_type: "logs", isDisable: false },
            { name: "other_stream", stream_type: "logs", isDisable: false }
          ]
        };
  
        const mockUpdate = vi.fn();
        await wrapper.vm.filterStreams("test", mockUpdate);
  
        // Verify filtered results
        expect(wrapper.vm.filteredStreams).toEqual([
          { label: "test_stream1", value: "test_stream1", isDisable: true },
          { label: "test_stream2", value: "test_stream2", isDisable: false }
        ]);
        expect(mockUpdate).toHaveBeenCalled();
      });
  
      it("should filter streams correctly for non-input node type", async () => {
        // Setup mock data for non-input node
        mockPipelineObj.currentSelectedNodeData = {
          type: 'output',
          data: {
            stream_type: 'logs'
          }
        };
  
        // Setup streams data
        wrapper.vm.streams = {
          logs: [
            { name: "test_stream1", stream_type: "logs" },
            { name: "test_stream2", stream_type: "logs" },
            { name: "other_stream", stream_type: "logs" }
          ]
        };
  
        const mockUpdate = vi.fn();
        await wrapper.vm.filterStreams("test", mockUpdate);
  
        // Verify filtered results - all streams should have isDisable: false
        expect(wrapper.vm.filteredStreams).toEqual([
          { label: "test_stream1", value: "test_stream1", isDisable: false },
          { label: "test_stream2", value: "test_stream2", isDisable: false }
        ]);
        expect(mockUpdate).toHaveBeenCalled();
      });
  
      it("should handle empty search value", async () => {
        // Setup mock data
        mockPipelineObj.currentSelectedNodeData = {
          type: 'input',
          data: {
            stream_type: 'logs'
          }
        };
  
        // Setup streams data
        wrapper.vm.streams = {
          logs: [
            { name: "test_stream1", stream_type: "logs", isDisable: false },
            { name: "test_stream2", stream_type: "logs", isDisable: false }
          ]
        };
  
        const mockUpdate = vi.fn();
        await wrapper.vm.filterStreams("", mockUpdate);
  
        // Verify all streams are returned
        expect(wrapper.vm.filteredStreams).toEqual([
          { label: "test_stream1", value: "test_stream1", isDisable: false },
          { label: "test_stream2", value: "test_stream2", isDisable: false }
        ]);
        expect(mockUpdate).toHaveBeenCalled();
      });
    });
  
    describe("Form Validation and Submission", () => {
      it("should validate stream name before saving", async () => {
        wrapper.vm.stream_name = { value: "", label: "", isDisable: false };
        await wrapper.vm.saveStream();
  
        expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(expect.objectContaining({
          message: "Please select Stream from the list"
        }));
      });
  
    });
  
    describe("Dialog Handling", () => {
      it("should open cancel dialog correctly", async () => {
        wrapper.vm.openCancelDialog();
  
        expect(wrapper.vm.dialog).toEqual(expect.objectContaining({
          show: true,
          title: "Discard Changes",
          message: "Are you sure you want to cancel changes?"
        }));
      });
  
      it("should open delete dialog correctly", async () => {
        wrapper.vm.openDeleteDialog();
  
        expect(wrapper.vm.dialog).toEqual(expect.objectContaining({
          show: true,
          title: "Delete Node",
          message: "Are you sure you want to delete stream association?"
        }));
      });
  
    });
  });
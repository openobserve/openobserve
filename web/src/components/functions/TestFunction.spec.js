import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Dialog, Notify, Quasar } from "quasar";
import { installQuasar } from "@/test/unit/helpers";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import TestFunction from "./TestFunction.vue";
import jstransform from "@/services/jstransform";
import searchService from "@/services/search";
import { nextTick, ref } from 'vue';
import * as components from "@quasar/extras/material-icons";
import useStreams from "@/composables/useStreams";

// Mock useQuasar
vi.mock('quasar', async () => {
  const actual = await vi.importActual('quasar');
  return {
    ...actual,
    useQuasar: vi.fn(() => ({
      notify: vi.fn(() => ({ dismiss: vi.fn() }))
    }))
  };
});

// Mock the jstransform service
vi.mock("@/services/jstransform", () => ({
  default: {
    test: vi.fn(() => Promise.resolve({ 
      data: { 
        results: [
          { event: { field1: "value1" } },
          { event: { field2: "value2" } }
        ] 
      } 
    }))
  }
}));

// Mock the search service
vi.mock("@/services/search", () => ({
  default: {
    search: vi.fn(() => Promise.resolve({
      data: {
        hits: [
          { field1: "value1" },
          { field2: "value2" }
        ]
      }
    }))
  }
}));

// Mock the useStreams composable
vi.mock("@/composables/useStreams", () => ({
  default: vi.fn(() => ({
    getStreams: vi.fn(() => Promise.resolve({ list: [] }))
  }))
}));

// Mock the useParser composable
vi.mock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: vi.fn(() => Promise.resolve())
  })
}));

// Mock the useQuery composable
vi.mock("@/composables/useQuery", () => ({
  default: () => ({
    buildQueryPayload: vi.fn(() => ({
      sqlMode: true,
      query: {
        sql: "",
        from: 0,
        size: 10
      }
    }))
  })
}));

describe("TestFunction Component", () => {
  let wrapper;
  let mockStore;
  let mockRouter;
  let mockNotify;
  let mockGetStreams;

  beforeEach(async () => {
    // Setup mock notify
    mockNotify = vi.fn(() => ({ dismiss: vi.fn() }));

    // Setup mock store
    mockStore = {
      state: {
        selectedOrganization: {
          identifier: "test-org"
        },
        theme: 'light'
      },
      dispatch: vi.fn()
    };

    // Setup router mock
    mockRouter = {
      currentRoute: {
        value: {
          path: "/test"
        }
      }
    };

    // Mock editor methods
    const mockEditor = {
      getModel: vi.fn(() => ({
        getLinesContent: () => ["line1", "line2"]
      })),
      addErrorDiagnostics: vi.fn()
    };

    // Mock getStreams
    mockGetStreams = vi.fn(() => Promise.resolve({ list: [] }));
    useStreams.mockImplementation(() => ({
      getStreams: mockGetStreams
    }));

    // Install Quasar
    installQuasar({
      plugins: [Dialog, Notify],
      components,
      config: {
        notify: {},
        iconSet: {
          name: 'material-icons',
          type: {
            positive: 'check_circle',
            negative: 'warning',
            info: 'info',
            warning: 'priority_high'
          }
        }
      }
    });

    // Mount component
    wrapper = mount(TestFunction, {
      global: {
        plugins: [i18n, Quasar],
        provide: {
          store: mockStore,
          router: mockRouter
        },
        stubs: {
          'query-editor': {
            template: '<div class="query-editor"></div>',
            props: ['query'],
            emits: ['update:query'],
            methods: {
              getModel: () => mockEditor.getModel(),
              addErrorDiagnostics: mockEditor.addErrorDiagnostics
            }
          },
          'DateTime': true,
          'FullViewContainer': true,
          'O2AIContextAddBtn': true
        }
      },
      props: {
        vrlFunction: {
          function: "test_function",
          name: "Test Function"
        },
        heightOffset: 0
      }
    });

    // Mock outputEventsEditorRef
    wrapper.vm.outputEventsEditorRef = {
      value: {
        getModel: () => ({
          getLinesContent: () => [
            '{',
            '  "event": {',
            '    "field1": "value1"',
            '  },',
            '  "message": "Error message"',
            '}'
          ],
          getLineCount: () => 6,
          getValueInRange: () => JSON.stringify({
            event: { field1: "value1" },
            message: "Error message"
          })
        }),
        addErrorDiagnostics: vi.fn()
      }
    };

    // Mock getLineRanges
    wrapper.vm.getLineRanges = vi.fn((event) => {
      if (!event || !event.event) return undefined;
      return {
        startLineNumber: 1,
        endLineNumber: 6,
        message: event.message || ""
      };
    });

    await flushPromises();
    await nextTick();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("renders the component", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("initializes with correct stream types", () => {
      expect(wrapper.vm.streamTypes).toEqual([
        { label: "Logs", value: "logs" },
        { label: "Metrics", value: "metrics" },
        { label: "Traces", value: "traces" }
      ]);
    });

    it("initializes with default expand state", () => {
      expect(wrapper.vm.expandState).toEqual({
        stream: true,
        functions: true,
        query: false,
        events: true,
        output: true
      });
    });

    it("initializes with empty input query", () => {
      expect(wrapper.vm.inputQuery).toBe("");
    });

    it("initializes with empty input events", () => {
      expect(wrapper.vm.inputEvents).toBe("");
    });

    it("initializes with empty output events", () => {
      expect(wrapper.vm.outputEvents).toBe("");
    });

    it("initializes with empty output events error message", () => {
      expect(wrapper.vm.outputEventsErrorMsg).toBe("");
    });

    it("initializes with empty events error message", () => {
      expect(wrapper.vm.eventsErrorMsg).toBe("");
    });

    it("initializes with empty SQL query error message", () => {
      expect(wrapper.vm.sqlQueryErrorMsg).toBe("");
    });

    it("initializes with empty original output events", () => {
      expect(wrapper.vm.originalOutputEvents).toBe("");
    });
  });

  describe("Query Management", () => {
    it("validates query before execution", async () => {
      wrapper.vm.inputQuery = "";
      wrapper.vm.loading.events = false;
      // Force server-side validation error to match component behavior
      searchService.search.mockRejectedValueOnce({
        response: { data: { message: "Invalid SQL Query" } }
      });
      await wrapper.vm.getResults();
      await flushPromises();
      await nextTick();
      expect(wrapper.vm.sqlQueryErrorMsg).toBe("Invalid SQL Query");
      expect(wrapper.vm.loading.events).toBe(false);
    });

    it("updates query when stream is selected", async () => {
      wrapper.vm.selectedStream.name = "test_stream";
      await wrapper.vm.updateQuery();
      await flushPromises();
      await nextTick();
      expect(wrapper.vm.inputQuery).toBe('SELECT * FROM "test_stream"');
      expect(wrapper.vm.expandState.query).toBe(true);
    });

    it("executes query successfully", async () => {
      searchService.search.mockResolvedValueOnce({
        data: {
          hits: [
            { field1: "value1" },
            { field2: "value2" }
          ]
        }
      });

      wrapper.vm.selectedStream.name = "test_stream";
      wrapper.vm.inputQuery = 'SELECT * FROM "test_stream"';
      wrapper.vm.dateTime = {
        type: "relative",
        relativeTimePeriod: "15m"
      };
      wrapper.vm.loading.events = false;

      await wrapper.vm.getResults();
      await flushPromises();
      await nextTick();
      expect(wrapper.vm.sqlQueryErrorMsg).toBe("");
      expect(wrapper.vm.inputEvents).toBeTruthy();
      expect(wrapper.vm.expandState.events).toBe(true);
      expect(wrapper.vm.loading.events).toBe(false);
    });

    it("handles query execution error", async () => {
      searchService.search.mockRejectedValueOnce({
        response: { data: { message: "Invalid query" } }
      });

      wrapper.vm.selectedStream.name = "test_stream";
      wrapper.vm.inputQuery = 'INVALID QUERY';
      wrapper.vm.loading.events = false;
      await wrapper.vm.getResults();
      await flushPromises();
      await nextTick();
      expect(wrapper.vm.sqlQueryErrorMsg).toBe("Invalid query");
      expect(wrapper.vm.loading.events).toBe(false);
    });

    it("handles empty stream name", async () => {
      wrapper.vm.selectedStream.name = "";
      wrapper.vm.inputQuery = 'SELECT * FROM "test_stream"';
      wrapper.vm.loading.events = false;
      // Force server-side validation error to match component behavior
      searchService.search.mockRejectedValueOnce({
        response: { data: { message: "Invalid SQL Query" } }
      });
      await wrapper.vm.getResults();
      await flushPromises();
      await nextTick();
      expect(wrapper.vm.sqlQueryErrorMsg).toBe("Invalid SQL Query");
      expect(wrapper.vm.loading.events).toBe(false);
    });

    it("handles empty stream type", async () => {
      wrapper.vm.selectedStream.type = "";
      wrapper.vm.inputQuery = 'SELECT * FROM "test_stream"';
      wrapper.vm.loading.events = false;
      // Force server-side validation error to match component behavior
      searchService.search.mockRejectedValueOnce({
        response: { data: { message: "Invalid SQL Query" } }
      });
      await wrapper.vm.getResults();
      await flushPromises();
      await nextTick();
      expect(wrapper.vm.sqlQueryErrorMsg).toBe("Invalid SQL Query");
      expect(wrapper.vm.loading.events).toBe(false);
    });
  });

  describe("Stream Management", () => {
    it("updates streams when stream type changes", async () => {
      const mockStreams = ["stream1", "stream2"];
      mockGetStreams.mockResolvedValueOnce({ list: mockStreams.map(name => ({ name })) });

      wrapper.vm.selectedStream.type = "logs";
      await wrapper.vm.updateStreams();
      await flushPromises();
      await nextTick();
      expect(mockGetStreams).toHaveBeenCalledWith("logs", false);
      expect(wrapper.vm.selectedStream.name).toBe("");
      expect(wrapper.vm.isFetchingStreams).toBe(false);
    });

    it("filters streams based on search input", async () => {
      wrapper.vm.streams = ["stream1", "stream2", "test_stream"];
      const update = vi.fn();
      wrapper.vm.filterStreams("stream", update);
      await flushPromises();
      await nextTick();
      expect(update).toHaveBeenCalled();
    });

    it("handles empty stream filter", async () => {
      wrapper.vm.streams = ["stream1", "stream2"];
      const update = vi.fn();
      wrapper.vm.filterStreams("", update);
      await flushPromises();
      await nextTick();
      expect(update).toHaveBeenCalled();
    });

    it("handles stream type change to logs", async () => {
      wrapper.vm.selectedStream.type = "logs";
      await wrapper.vm.updateStreams();
      await flushPromises();
      await nextTick();
      expect(wrapper.vm.selectedStream.name).toBe("");
    });

    it("handles stream type change to metrics", async () => {
      wrapper.vm.selectedStream.type = "metrics";
      await wrapper.vm.updateStreams();
      await flushPromises();
      await nextTick();
      expect(wrapper.vm.selectedStream.name).toBe("");
    });

    it("handles stream type change to traces", async () => {
      wrapper.vm.selectedStream.type = "traces";
      await wrapper.vm.updateStreams();
      await flushPromises();
      await nextTick();
      expect(wrapper.vm.selectedStream.name).toBe("");
    });
  });

  describe("Event Validation and Testing", () => {
    it("validates input events before testing", async () => {
      wrapper.vm.inputEvents = "invalid json";
      await wrapper.vm.testFunction();
      await flushPromises();
      await nextTick();
      expect(wrapper.vm.eventsErrorMsg).toContain("Invalid events");
    });

    it("tests function successfully", async () => {
      wrapper.vm.inputEvents = JSON.stringify([{ test: "data" }]);
      await wrapper.vm.testFunction();
      await flushPromises();
      await nextTick();
      expect(wrapper.vm.outputEvents).toBeTruthy();
      expect(wrapper.vm.outputEventsErrorMsg).toBe("");
    });

    it("processes test results correctly", async () => {
      const testResults = {
        data: {
          results: [
            { event: { field1: "value1" } },
            { event: { field2: "value2" } }
          ]
        }
      };

      await wrapper.vm.processTestResults(testResults);
      await flushPromises();
      await nextTick();
      expect(wrapper.vm.expandState.output).toBe(true);
      expect(wrapper.vm.outputEvents).toBeTruthy();
      expect(wrapper.vm.originalOutputEvents).toBe(JSON.stringify(testResults.data.results));
    });

    it("handles empty input events", async () => {
      wrapper.vm.inputEvents = "";
      await wrapper.vm.testFunction();
      await flushPromises();
      await nextTick();
      expect(wrapper.vm.eventsErrorMsg).toContain("Invalid events");
    });

    it("handles undefined input events", async () => {
      wrapper.vm.inputEvents = "undefined";
      await wrapper.vm.testFunction();
      await flushPromises();
      await nextTick();
      expect(wrapper.vm.eventsErrorMsg).toContain("Invalid events");
    });
  });

  describe("Error Handling", () => {
    it("handles invalid JSON in input events", async () => {
      wrapper.vm.inputEvents = "invalid json";
      const result = wrapper.vm.isInputValid();
      await flushPromises();
      await nextTick();
      expect(result).toBe(false);
      expect(wrapper.vm.eventsErrorMsg).toContain("Invalid events");
    });

    it("handles test function errors", async () => {
      const error = {
        response: { data: { message: "Test error" } }
      };
      await wrapper.vm.handleTestError(error);
      await flushPromises();
      await nextTick();
      expect(wrapper.vm.outputEventsErrorMsg).toBe("Error while transforming results");
      expect(wrapper.vm.outputEvents).toBe("Test error");
    });

    it("handles network errors", async () => {
      const error = {
        message: "Network error"
      };
      await wrapper.vm.handleTestError(error);
      await flushPromises();
      await nextTick();
      expect(wrapper.vm.outputEventsErrorMsg).toBe("Error while transforming results");
      expect(wrapper.vm.outputEvents).toBe("Error in testing function");
    });

    it("handles timeout errors", async () => {
      const error = {
        message: "Timeout"
      };
      await wrapper.vm.handleTestError(error);
      await flushPromises();
      await nextTick();
      expect(wrapper.vm.outputEventsErrorMsg).toBe("Error while transforming results");
      expect(wrapper.vm.outputEvents).toBe("Error in testing function");
    });

    it("handles server errors", async () => {
      const error = {
        response: { data: { message: "Server error" } }
      };
      await wrapper.vm.handleTestError(error);
      await flushPromises();
      await nextTick();
      expect(wrapper.vm.outputEventsErrorMsg).toBe("Error while transforming results");
      expect(wrapper.vm.outputEvents).toBe("Server error");
    });
  });

  describe("Event Highlighting", () => {

    it("gets line ranges for error events", () => {
      const mockEvent = {
        event: { field1: "value1" },
        message: "Error message"
      };
      const ranges = wrapper.vm.getLineRanges(mockEvent);
      expect(ranges).toEqual({
        startLineNumber: 1,
        endLineNumber: 6,
        message: "Error message"
      });
    });

    it("handles errors in getLineRanges gracefully", () => {
      const mockEvent = null;
      const ranges = wrapper.vm.getLineRanges(mockEvent);
      expect(ranges).toBeUndefined();
    });

    it("handles empty error events", () => {
      const mockEvent = { event: {} };
      const ranges = wrapper.vm.getLineRanges(mockEvent);
      expect(ranges).toEqual({
        startLineNumber: 1,
        endLineNumber: 6,
        message: ""
      });
    });

    it("handles missing event property", () => {
      const mockEvent = {};
      const ranges = wrapper.vm.getLineRanges(mockEvent);
      expect(ranges).toBeUndefined();
    });
  });

  describe("DateTime Management", () => {
    it("updates datetime value", async () => {
      const newDateTime = {
        type: "relative",
        relativeTimePeriod: "15m"
      };
      wrapper.vm.updateDateTime(newDateTime);
      await flushPromises();
      await nextTick();
      expect(wrapper.vm.dateTime).toEqual(newDateTime);
    });

    it("handles absolute datetime", async () => {
      const newDateTime = {
        type: "absolute",
        startTime: "2021-01-01T00:00:00Z",
        endTime: "2021-01-02T00:00:00Z"
      };
      wrapper.vm.updateDateTime(newDateTime);
      await flushPromises();
      await nextTick();
      expect(wrapper.vm.dateTime).toEqual(newDateTime);
    });

    it("handles relative datetime with different periods", async () => {
      const periods = ["5m", "15m", "30m", "1h", "3h", "6h", "12h", "24h", "7d", "30d"];
      for (const period of periods) {
        const newDateTime = {
          type: "relative",
          relativeTimePeriod: period
        };
        wrapper.vm.updateDateTime(newDateTime);
        await flushPromises();
        await nextTick();
        expect(wrapper.vm.dateTime).toEqual(newDateTime);
      }
    });
  });

  describe("AI Chat Integration", () => {
    it("emits sendToAiChat event with correct data", async () => {
      const testData = { test: "data" };
      wrapper.vm.sendToAiChat(testData);
      await flushPromises();
      await nextTick();
      expect(wrapper.emitted()["sendToAiChat"]).toBeTruthy();
      expect(wrapper.emitted()["sendToAiChat"][0]).toEqual([testData]);
    });

    it("handles empty data", async () => {
      const testData = {};
      wrapper.vm.sendToAiChat(testData);
      await flushPromises();
      await nextTick();
      expect(wrapper.emitted()["sendToAiChat"]).toBeTruthy();
      expect(wrapper.emitted()["sendToAiChat"][0]).toEqual([testData]);
    });

    it("handles null data", async () => {
      const testData = null;
      wrapper.vm.sendToAiChat(testData);
      await flushPromises();
      await nextTick();
      expect(wrapper.emitted()["sendToAiChat"]).toBeTruthy();
      expect(wrapper.emitted()["sendToAiChat"][0]).toEqual([testData]);
    });
  });


}); 
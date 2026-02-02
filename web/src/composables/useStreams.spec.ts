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

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import useStreams from "@/composables/useStreams";
import StreamService from "@/services/stream";

// Mock Stream Service
vi.mock("@/services/stream", () => ({
  default: {
    nameList: vi.fn(),
    schema: vi.fn()
  }
}));

// Mock Quasar
const mockNotify = vi.fn().mockReturnValue(() => {});
vi.mock("quasar", () => ({
  useQuasar: () => ({
    notify: mockNotify
  })
}));

// Mock utilities
vi.mock("@/utils/zincutils", () => ({
  deepCopy: vi.fn((obj) => JSON.parse(JSON.stringify(obj)))
}));

// Mock Store
const createMockStore = () => ({
  state: {
    selectedOrganization: {
      identifier: "test-org"
    },
    streams: {
      logs: null,
      metrics: null,
      traces: null,
      enrichment_tables: null,
      index: null,
      metadata: null,
      streamsIndexMapping: {
        logs: {},
        metrics: {},
        traces: {},
        enrichment_tables: {},
        index: {},
        metadata: {}
      },
      areStreamsFetched: false
    },
    organizationData: {
      isDataIngested: false
    }
  },
  dispatch: vi.fn(),
  commit: vi.fn()
});

let mockStore: ReturnType<typeof createMockStore>;

vi.mock("vuex", () => ({
  useStore: () => mockStore
}));

describe("useStreams Composable", () => {
  let streamsInstance: ReturnType<typeof useStreams>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStore = createMockStore();
    
    // Set up default mocks
    const mockStreamService = vi.mocked(StreamService);
    mockStreamService.nameList.mockResolvedValue({
      data: { 
        list: [
          { name: "test-stream", stream_type: "logs" }
        ]
      }
    });
    mockStreamService.schema.mockResolvedValue({
      data: {
        name: "test-stream",
        stream_type: "logs",
        schema: [
          { name: "field1", type: "string" },
          { name: "_o2_id", type: "string" },
          { name: "_original", type: "string" },
          { name: "_all_values", type: "string" }
        ]
      }
    });

    streamsInstance = useStreams();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  // Test 1: Composable Initialization
  describe("Composable Initialization", () => {
    it("should initialize useStreams composable with all methods", () => {
      expect(streamsInstance).toBeDefined();
      
      const expectedMethods = [
        'getStreams', 'getStream', 'setStreams', 'getMultiStreams',
        'resetStreams', 'removeStream', 'addStream', 'getUpdatedSettings',
        'resetStreamType', 'getPaginatedStreams', 'isStreamExists',
        'isStreamFetched', 'addNewStreams', 'updateStreamsInStore',
        'updateStreamIndexMappingInStore', 'updateStreamsFetchedInStore',
        'getAllStreamsPayload', 'removeSchemaFields', 'getStreamPayload',
        'compareArrays', 'deepEqual', 'comparePatternAssociations'
      ];

      expectedMethods.forEach(method => {
        expect(streamsInstance).toHaveProperty(method);
        expect(typeof streamsInstance[method]).toBe("function");
      });
    });
  });

  // Test 2-5: Store Update Functions
  describe("Store Update Functions", () => {
    it("should call store dispatch for updateStreamsInStore", () => {
      const streamType = "logs";
      const streams = { list: [] };
      
      streamsInstance.updateStreamsInStore(streamType, streams);
      
      expect(mockStore.dispatch).toHaveBeenCalledWith("streams/setStreams", { streamType, streams });
    });

    it("should call store commit for updateStreamIndexMappingInStore", () => {
      const indexMapping = { logs: { "test": 0 } };
      
      streamsInstance.updateStreamIndexMappingInStore(indexMapping);
      
      expect(mockStore.commit).toHaveBeenCalledWith("streams/updateStreamIndexMapping", indexMapping);
    });

    it("should call store commit for updateStreamsFetchedInStore", () => {
      const areStreamsFetched = true;
      
      streamsInstance.updateStreamsFetchedInStore(areStreamsFetched);
      
      expect(mockStore.commit).toHaveBeenCalledWith("streams/updateStreamsFetched", areStreamsFetched);
    });

    it("should return stream payload structure from getStreamPayload", () => {
      const payload = streamsInstance.getStreamPayload();
      
      expect(payload).toEqual({
        name: "",
        list: [],
        schema: false
      });
    });
  });

  // Test 6-10: Stream Fetching Functions
  describe("Stream Fetching Functions", () => {
    it("should get streams for specific stream type", async () => {
      mockStore.state.streams.logs = null; // Not fetched yet
      
      const result = await streamsInstance.getStreams("logs", false, false);
      
      expect(StreamService.nameList).toHaveBeenCalledWith("test-org", "logs", false);
      expect(result).toHaveProperty("name", "logs");
      expect(result).toHaveProperty("list");
    });

    it("should get all streams when streamName is 'all'", async () => {
      mockStore.state.streams.areStreamsFetched = false;
      
      const result = await streamsInstance.getStreams("all", false, false);
      
      expect(result).toHaveProperty("name", "all");
    });

    it("should return cached streams if already fetched", async () => {
      // Mock streams as already fetched
      mockStore.state.streams.logs = { list: [{ name: "cached" }] };
      mockStore.state.streams.areStreamsFetched = false;
      
      const result = await streamsInstance.getStreams("logs", false, false);
      
      expect(result).toEqual({ list: [{ name: "cached" }] });
      expect(StreamService.nameList).not.toHaveBeenCalled();
    });

    it("should force fetch streams when force parameter is true", async () => {
      mockStore.state.streams.logs = { list: [{ name: "cached" }] };
      
      await streamsInstance.getStreams("logs", false, false, true);
      
      expect(StreamService.nameList).toHaveBeenCalled();
    });

    it("should handle getPaginatedStreams with all parameters", async () => {
      const result = await streamsInstance.getPaginatedStreams(
        "logs", false, true, 0, 50, "test", "name", true
      );
      
      expect(StreamService.nameList).toHaveBeenCalledWith(
        "test-org", "logs", false, 0, 50, "test", "name", true
      );
      expect(result).toHaveProperty("name", "logs");
      expect(result).toHaveProperty("total");
    });
  });

  // Test 11-15: Individual Stream Functions
  describe("Individual Stream Functions", () => {
    it("should return null for getStream with empty parameters", async () => {
      const result = await streamsInstance.getStream("", "logs", false);
      expect(result).toBeNull();
    });

    it("should get stream with schema when requested", async () => {
      // Set up stream in cache
      mockStore.state.streams.logs = {
        list: [{ name: "test-stream", schema: [] }]
      };
      mockStore.state.streams.streamsIndexMapping.logs["test-stream"] = 0;
      
      const result = await streamsInstance.getStream("test-stream", "logs", true);
      
      expect(StreamService.schema).toHaveBeenCalledWith("test-org", "test-stream", "logs");
    });

    it("should reject with 'Stream Not Found' for non-existent stream", async () => {
      mockStore.state.streams.logs = { list: [] };

      await expect(streamsInstance.getStream("non-existent", "logs", false))
        .rejects.toThrow("Stream 'non-existent' not found for type 'logs'");
    });

    it("should handle getMultiStreams with valid streams", async () => {
      const streams = [
        { streamName: "stream1", streamType: "logs", schema: false },
        { streamName: "stream2", streamType: "metrics", schema: true }
      ];
      
      mockStore.state.streams.logs = { list: [{ name: "stream1" }] };
      mockStore.state.streams.metrics = { list: [{ name: "stream2" }] };
      mockStore.state.streams.streamsIndexMapping.logs["stream1"] = 0;
      mockStore.state.streams.streamsIndexMapping.metrics["stream2"] = 0;
      
      const results = await streamsInstance.getMultiStreams(streams);
      
      expect(results).toHaveLength(2);
    });

    it("should return null for getMultiStreams with empty parameters", async () => {
      const streams = [
        { streamName: "", streamType: "logs", schema: false },
        { streamName: "test", streamType: "", schema: false }
      ];
      
      const results = await streamsInstance.getMultiStreams(streams);
      
      expect(results).toEqual([null, null]);
    });
  });

  // Test 16-20: Schema and Data Manipulation
  describe("Schema and Data Manipulation", () => {
    it("should remove schema fields (_o2_id, _original, _all_values)", () => {
      const streamData = {
        name: "test",
        schema: [
          { name: "field1", type: "string" },
          { name: "_o2_id", type: "string" },
          { name: "_original", type: "string" },
          { name: "_all_values", type: "string" },
          { name: "field2", type: "number" }
        ]
      };
      
      const result = streamsInstance.removeSchemaFields(streamData);
      
      expect(result.schema).toHaveLength(2);
      expect(result.schema.map((f: any) => f.name)).toEqual(["field1", "field2"]);
    });

    it("should handle removeSchemaFields with no schema", () => {
      const streamData = { name: "test" };
      
      const result = streamsInstance.removeSchemaFields(streamData);
      
      expect(result).toEqual({ name: "test" });
    });

    it("should check if stream is fetched correctly", () => {
      // Test with specific stream type
      mockStore.state.streams.logs = { list: [{ name: "test" }] };
      expect(streamsInstance.isStreamFetched("logs")).toBe(true);

      mockStore.state.streams.metrics = null;
      expect(streamsInstance.isStreamFetched("metrics")).toBe(false);

      // Test with 'all'
      mockStore.state.streams.areAllStreamsFetched = true;
      expect(streamsInstance.isStreamFetched("all")).toBe(true);
    });

    it("should check if specific stream exists", () => {
      mockStore.state.streams.streamsIndexMapping.logs["existing-stream"] = 0;
      
      expect(streamsInstance.isStreamExists("existing-stream", "logs")).toBe(true);
      expect(streamsInstance.isStreamExists("non-existing", "logs")).toBe(false);
    });

    it("should handle isStreamExists with missing stream type", () => {
      mockStore.state.streams.streamsIndexMapping = {};
      
      expect(streamsInstance.isStreamExists("any-stream", "logs")).toBe(false);
    });
  });

  // Test 21-25: Stream Management Functions
  describe("Stream Management Functions", () => {
    it("should set streams and update store correctly", () => {
      const streamList = [
        { name: "stream1", stream_type: "logs" },
        { name: "stream2", stream_type: "logs" }
      ];
      
      streamsInstance.setStreams("logs", streamList);
      
      expect(mockStore.dispatch).toHaveBeenCalledWith("streams/setStreams", 
        expect.objectContaining({
          streamType: "logs",
          streams: expect.objectContaining({
            name: "logs",
            list: streamList,
            schema: false
          })
        })
      );
    });

    it("should handle setStreams with 'all' streamName", () => {
      const streamList = [
        { name: "stream1", stream_type: "logs" },
        { name: "stream2", stream_type: "metrics" }
      ];
      
      streamsInstance.setStreams("all", streamList);
      
      // Should dispatch multiple times for different stream types
      expect(mockStore.dispatch).toHaveBeenCalledWith("streams/setStreams", 
        expect.objectContaining({
          streamType: "logs"
        })
      );
      expect(mockStore.dispatch).toHaveBeenCalledWith("streams/setStreams", 
        expect.objectContaining({
          streamType: "metrics"
        })
      );
    });

    it("should add stream to existing cache", async () => {
      const newStream = { name: "new-stream", stream_type: "logs" };
      mockStore.state.streams.logs = { list: [] };
      mockStore.state.streams.streamsIndexMapping.logs = {};
      
      await streamsInstance.addStream(newStream);
      
      expect(mockStore.dispatch).toHaveBeenCalledWith("streams/setStreams", 
        expect.objectContaining({
          streamType: "logs"
        })
      );
    });

    it("should not add duplicate stream", async () => {
      const existingStream = { name: "existing", stream_type: "logs" };
      mockStore.state.streams.logs = { list: [] };
      mockStore.state.streams.streamsIndexMapping.logs = { "existing": 0 };
      
      await streamsInstance.addStream(existingStream);
      
      // Should not call dispatch since stream already exists
      expect(mockStore.dispatch).not.toHaveBeenCalled();
    });

    it("should remove stream from cache correctly", () => {
      mockStore.state.streams.logs = {
        list: [
          { name: "stream1" },
          { name: "stream2" },
          { name: "stream3" }
        ]
      };
      mockStore.state.streams.streamsIndexMapping.logs = {
        "stream1": 0,
        "stream2": 1,
        "stream3": 2
      };
      
      streamsInstance.removeStream("stream2", "logs");
      
      expect(mockStore.dispatch).toHaveBeenCalled();
    });
  });

  // Test 26-30: Utility Functions
  describe("Utility Functions", () => {
    it("should compare arrays correctly", () => {
      const previousArray = {
        0: { field: "field1", value: "old" },
        1: { field: "field2", value: "same" }
      };
      const currentArray = [
        { field: "field2", value: "same" },
        { field: "field3", value: "new" }
      ];
      
      const result = streamsInstance.compareArrays(previousArray, currentArray);
      
      expect(result.add).toHaveLength(1);
      expect(result.add[0].field).toBe("field3");
      expect(result.remove).toHaveLength(1);
      expect(result.remove[0].field).toBe("field1");
    });

    it("should perform deep equality check correctly", () => {
      const obj1 = { a: 1, b: { c: 2 } };
      const obj2 = { a: 1, b: { c: 2 } };
      const obj3 = { a: 1, b: { c: 3 } };
      
      expect(streamsInstance.deepEqual(obj1, obj2)).toBe(true);
      expect(streamsInstance.deepEqual(obj1, obj3)).toBe(false);
      expect(streamsInstance.deepEqual(null, null)).toBe(true);
      expect(streamsInstance.deepEqual(null, obj1)).toBe(false);
    });

    it("should handle deepEqual with different key lengths", () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { a: 1, b: 2, c: 3 };
      
      expect(streamsInstance.deepEqual(obj1, obj2)).toBe(false);
    });

    it("should compare pattern associations correctly", () => {
      const prev = [
        { field: "field1", pattern_id: "p1", policy: "policy1", apply_at: "ingest" },
        { field: "field2", pattern_id: "p2", policy: "policy2", apply_at: null }
      ];
      const curr = [
        { field: "field1", pattern_id: "p1", policy: "policy1", apply_at: "ingest" },
        { field: "field3", pattern_id: "p3", policy: "policy3", apply_at: "query" }
      ];
      
      const result = streamsInstance.comparePatternAssociations(prev, curr);
      
      expect(result.add).toHaveLength(1);
      expect(result.add[0].field).toBe("field3");
      expect(result.remove).toHaveLength(1);
      expect(result.remove[0].field).toBe("field2");
    });

    it("should handle pattern associations with null apply_at", () => {
      const prev = [{ field: "field1", pattern_id: "p1", policy: "policy1", apply_at: null }];
      const curr = [{ field: "field1", pattern_id: "p1", policy: "policy1", apply_at: undefined }];
      
      const result = streamsInstance.comparePatternAssociations(prev, curr);
      
      expect(result.add).toHaveLength(0);
      expect(result.remove).toHaveLength(0);
    });
  });

  // Test 31-35: Settings and Configuration
  describe("Settings and Configuration Functions", () => {
    it("should get updated settings for various attributes", () => {
      const previousSettings = {
        fields: ["field1", "field2"],
        partition_keys: [{ field: "pk1", disabled: false }],
        index_fields: ["index1"],
        full_text_search_keys: ["fts1"],
        bloom_filter_fields: ["bloom1"],
        defined_schema_fields: ["schema1"],
        extended_retention_days: [{ days: 30 }],
        pattern_associations: [{ field: "f1", pattern_id: "p1", policy: "pol1", apply_at: "ingest" }]
      };
      
      const currentSettings = {
        fields: ["field1", "field3"],
        partition_keys: [{ field: "pk2", disabled: false }],
        index_fields: ["index1", "index2"],
        full_text_search_keys: ["fts2"],
        bloom_filter_fields: ["bloom2"],
        defined_schema_fields: ["schema2"],
        extended_retention_days: [{ days: 60 }],
        pattern_associations: [{ field: "f2", pattern_id: "p2", policy: "pol2", apply_at: "query" }]
      };
      
      const result = streamsInstance.getUpdatedSettings(previousSettings, currentSettings);
      
      expect(result.fields.add).toEqual(["field3"]);
      expect(result.fields.remove).toEqual(["field2"]);
      expect(result.index_fields.add).toEqual(["index2"]);
    });

    it("should handle empty settings in getUpdatedSettings", () => {
      const result = streamsInstance.getUpdatedSettings({}, {});
      
      expect(result).toHaveProperty("fields");
      expect(result).toHaveProperty("partition_keys");
      expect(result.fields.add).toEqual([]);
      expect(result.fields.remove).toEqual([]);
    });

    it("should reset specific stream type", () => {
      streamsInstance.resetStreamType("logs");
      
      expect(mockStore.dispatch).toHaveBeenCalledWith("streams/setStreams", {
        streamType: "logs",
        streams: {}
      });
    });

    it("should handle resetStreamType with empty string", () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      streamsInstance.resetStreamType("");
      
      // Should not call dispatch
      expect(mockStore.dispatch).not.toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it("should handle resetStreamType error gracefully", () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Mock store dispatch to throw error
      mockStore.dispatch = vi.fn().mockImplementation(() => {
        throw new Error("Test error");
      });

      streamsInstance.resetStreamType("logs");

      expect(consoleSpy).toHaveBeenCalledWith("Error while clearing local cache for stream type.", expect.any(Error));

      // Restore
      consoleSpy.mockRestore();
      // Restore dispatch for subsequent tests
      mockStore.dispatch = vi.fn();
    });
  });

  // Test 36-40: Advanced Stream Operations  
  describe("Advanced Stream Operations", () => {
    it("should reset all streams completely", () => {
      streamsInstance.resetStreams();
      
      // Should reset all stream types
      const streamTypes = ['logs', 'metrics', 'traces', 'enrichment_tables', 'index', 'metadata'];
      streamTypes.forEach(type => {
        expect(mockStore.dispatch).toHaveBeenCalledWith("streams/setStreams", {
          streamType: type,
          streams: null
        });
      });
      
      expect(mockStore.commit).toHaveBeenCalledWith("streams/updateStreamIndexMapping", {});
      expect(mockStore.commit).toHaveBeenCalledWith("streams/updateStreamsFetched", false);
      expect(mockStore.dispatch).toHaveBeenCalledWith("setIsDataIngested", false);
    });

    it("should get all streams payload correctly", () => {
      mockStore.state.streams.logs = { list: [{ name: "log1" }] };
      mockStore.state.streams.metrics = { list: [{ name: "metric1" }] };
      
      const result = streamsInstance.getAllStreamsPayload();
      
      expect(result.name).toBe("all");
      expect(result.schema).toBe(false);
      expect(result.list).toEqual([{ name: "log1" }, { name: "metric1" }]);
    });

    it("should add new streams only if they don't exist", () => {
      const existingStreams = [{ name: "existing", stream_type: "logs" }];
      const newStreams = [
        { name: "existing", stream_type: "logs" },
        { name: "new-stream", stream_type: "logs" }
      ];
      
      mockStore.state.streams.logs = { list: existingStreams };
      mockStore.state.streams.streamsIndexMapping.logs = { "existing": 0 };
      
      streamsInstance.addNewStreams("logs", newStreams);
      
      // Should only add the new stream
      expect(mockStore.dispatch).toHaveBeenCalled();
    });

    it("should not add streams if all exist", () => {
      const existingStreams = [{ name: "existing", stream_type: "logs" }];
      const duplicateStreams = [{ name: "existing", stream_type: "logs" }];
      
      // Set up the cache properly
      mockStore.state.streams.logs = { list: existingStreams };
      mockStore.state.streams.streamsIndexMapping.logs = { "existing": 0 };
      
      // Clear previous calls
      vi.clearAllMocks();
      
      streamsInstance.addNewStreams("logs", duplicateStreams);
      
      // The function will still call setStreams with existing streams + no new streams
      // So we verify it's called with the same streams (no new additions)
      const setStreamsCalls = mockStore.dispatch.mock.calls.filter(
        call => call[0] === "streams/setStreams"
      );
      expect(setStreamsCalls).toHaveLength(1);
      expect(setStreamsCalls[0][1].streams.list).toEqual(existingStreams);
    });

    it("should handle addNewStreams with empty cache", () => {
      const newStreams = [{ name: "new-stream", stream_type: "logs" }];
      
      mockStore.state.streams.logs = null;
      
      streamsInstance.addNewStreams("logs", newStreams);
      
      expect(mockStore.dispatch).toHaveBeenCalled();
    });
  });

  // Test 41-45: Error Handling and Edge Cases
  describe("Error Handling and Edge Cases", () => {
    it("should handle StreamService.nameList rejection", async () => {
      vi.mocked(StreamService.nameList).mockRejectedValueOnce(new Error("Service error"));
      
      await expect(streamsInstance.getStreams("logs", false, false))
        .rejects.toThrow("Service error");
    });

    it("should handle StreamService.schema rejection in getStream", async () => {
      mockStore.state.streams.logs = { list: [{ name: "test", schema: [] }] };
      mockStore.state.streams.streamsIndexMapping.logs["test"] = 0;
      
      vi.mocked(StreamService.schema).mockRejectedValueOnce(new Error("Schema error"));

      await expect(streamsInstance.getStream("test", "logs", true))
        .rejects.toThrow("Error while fetching schema: Schema error");
    });

    it("should handle getPaginatedStreams service error", async () => {
      vi.mocked(StreamService.nameList).mockRejectedValueOnce(new Error("Pagination error"));
      
      await expect(streamsInstance.getPaginatedStreams("logs", false, true))
        .rejects.toThrow("Pagination error");
    });

    it("should handle getMultiStreams with schema fetch error", async () => {
      const streams = [{ streamName: "test", streamType: "logs", schema: true }];
      
      mockStore.state.streams.logs = { list: [{ name: "test", schema: null }] };
      mockStore.state.streams.streamsIndexMapping.logs["test"] = 0;
      
      vi.mocked(StreamService.schema).mockRejectedValueOnce(new Error("Schema error"));
      
      await expect(streamsInstance.getMultiStreams(streams)).rejects.toThrow("Schema error");
    });

    it("should handle isStreamExists with store access error", () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      // Create a store with an invalid structure to trigger the try-catch
      const originalStore = mockStore;
      mockStore.state.streams.streamsIndexMapping = {
        get logs() {
          throw new Error('Access error');
        }
      };
      
      const result = streamsInstance.isStreamExists("test", "logs");
      
      expect(result).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith('Error checking if stream exists:', expect.any(Error));
      
      // Restore
      mockStore = originalStore;
      consoleWarnSpy.mockRestore();
    });
  });

  // Test 46-50: Promise and Async Behavior
  describe("Promise and Async Behavior", () => {
    it("should handle concurrent getStreams calls properly", async () => {
      mockStore.state.streams.logs = null;
      
      const promise1 = streamsInstance.getStreams("logs", false, false);
      const promise2 = streamsInstance.getStreams("logs", false, false);
      
      const results = await Promise.all([promise1, promise2]);
      
      expect(results).toHaveLength(2);
      // Due to the implementation, each composable instance may call the service
      expect(StreamService.nameList).toHaveBeenCalled();
    });

    it("should handle notification dismissal in getStreams", async () => {
      const dismissMock = vi.fn();
      mockNotify.mockReturnValueOnce(dismissMock);
      
      mockStore.state.streams.logs = null;
      
      await streamsInstance.getStreams("logs", false, true);
      
      expect(mockNotify).toHaveBeenCalledWith({
        spinner: true,
        message: "Please wait while loading streams...",
        timeout: 5000
      });
      expect(dismissMock).toHaveBeenCalled();
    });

    it("should handle notification dismissal in getPaginatedStreams", async () => {
      const dismissMock = vi.fn();
      mockNotify.mockReturnValueOnce(dismissMock);
      
      await streamsInstance.getPaginatedStreams("logs", false, true);
      
      expect(dismissMock).toHaveBeenCalled();
    });

    it("should handle getStreams with notify=false", async () => {
      mockStore.state.streams.logs = null;
      
      await streamsInstance.getStreams("logs", false, false);
      
      expect(mockNotify).not.toHaveBeenCalled();
    });

    it("should handle Promise.allSettled with mixed results in getStreams", async () => {
      mockStore.state.streams.areStreamsFetched = false;
      
      // Mock one success and one failure
      vi.mocked(StreamService.nameList)
        .mockResolvedValueOnce({ data: { list: [{ name: "success", stream_type: "logs" }] } })
        .mockRejectedValueOnce(new Error("Failed"));
      
      const result = await streamsInstance.getStreams("all", false, false);
      
      expect(result.name).toBe("all");
    });
  });

  // Test 51-54: Data Ingestion and Store Integration
  describe("Data Ingestion and Store Integration", () => {
    it("should set isDataIngested when streams are added", () => {
      mockStore.state.organizationData.isDataIngested = false;
      const streamList = [{ name: "test", stream_type: "logs" }];
      
      streamsInstance.setStreams("logs", streamList);
      
      expect(mockStore.dispatch).toHaveBeenCalledWith("setIsDataIngested", true);
    });

    it("should not set isDataIngested for empty stream list", () => {
      mockStore.state.organizationData.isDataIngested = false;
      
      streamsInstance.setStreams("logs", []);
      
      expect(mockStore.dispatch).not.toHaveBeenCalledWith("setIsDataIngested", expect.anything());
    });

    it("should handle deepEqual with nested objects", () => {
      const obj1 = { a: { b: { c: 1 } } };
      const obj2 = { a: { b: { c: 1 } } };
      const obj3 = { a: { b: { c: 2 } } };
      
      expect(streamsInstance.deepEqual(obj1, obj2)).toBe(true);
      expect(streamsInstance.deepEqual(obj1, obj3)).toBe(false);
    });

    it("should handle setStreams force parameter behavior", () => {
      const streamList = [{ name: "test", stream_type: "logs" }];
      
      // Test 1: setStreams with force=true always sets streams
      vi.clearAllMocks();
      streamsInstance.setStreams("logs", streamList, true);
      expect(mockStore.dispatch).toHaveBeenCalledWith("streams/setStreams", 
        expect.objectContaining({
          streamType: "logs",
          streams: expect.objectContaining({
            list: streamList,
            name: "logs"
          })
        })
      );
      
      // Test 2: setStreams with force=true again should still work
      vi.clearAllMocks();
      streamsInstance.setStreams("logs", streamList, true);
      expect(mockStore.dispatch).toHaveBeenCalledWith("streams/setStreams", 
        expect.objectContaining({
          streamType: "logs"
        })
      );
      
      // Test 3: Verify that force parameter is passed correctly to the function
      vi.clearAllMocks();
      const emptyStreamList: any[] = [];
      streamsInstance.setStreams("metrics", emptyStreamList, true);
      expect(mockStore.dispatch).toHaveBeenCalledWith("streams/setStreams", 
        expect.objectContaining({
          streamType: "metrics",
          streams: expect.objectContaining({
            name: "metrics",
            list: emptyStreamList
          })
        })
      );
    });
  });
});
// Copyright 2023 OpenObserve Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { nextTick } from "vue";
import store from "@/test/unit/helpers/store";
import { flushPromises } from "@vue/test-utils";


// Mock modules
vi.mock("@/stores", () => ({
  default: {
    state: {
      API_ENDPOINT: "http://localhost:5080",
    },
  },
}));

vi.mock("@/utils/zincutils", () => ({
  getUUID: vi.fn(() => "test-uuid-1234-5678-9012"),
}));

// Mock Web Worker
class MockWorker {
    workerDataSent: any = null;
    onmessage: ((event: any) => void) | null = null;
    postMessage = vi.fn((msg: any) => {
      // Store the action for verification - keep history of all calls
      if (msg.action == 'cancelStream' || msg.action == 'closeAll') {
        this.workerDataSent = { ...msg };
      }
      // Don't auto-trigger messages - let tests control when worker responds
    });

    terminate = vi.fn();
}


// Mock ReadableStream
class MockReadableStream {
  constructor(private chunks: any[] = []) {}
  getReader() {
    return {
      read: vi.fn().mockImplementation(() => {
        if (this.chunks.length > 0) {
          return Promise.resolve({ value: this.chunks.shift(), done: false });
        }
        return Promise.resolve({ done: true });
      }),
      cancel: vi.fn(),
      releaseLock: vi.fn(),
    };
  }
}
let httpStreaming: any;
let mockFetch: any;
let mockWorker: MockWorker;

// Create a fresh instance for each test but keep reference
let mockWorkerInstance: MockWorker;

// We'll set up the Worker mock in beforeEach, NOT here
// This ensures that vi.clearAllMocks() doesn't break our mock

import useHttpStreaming from "./useStreamingSearch";

describe("useHttpStreaming", () => {

let onDataSpy: any;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Clear mocks first
    vi.clearAllMocks();

    // Setup Worker mock with implementation AFTER clearing mocks
    const workerMock = vi.fn();
    workerMock.mockImplementation(() => {
      console.log('Worker constructor called!');
      mockWorkerInstance = new MockWorker();
      mockWorker = mockWorkerInstance;  // Also set mockWorker immediately
      console.log('Created mockWorkerInstance:', mockWorkerInstance);
      return mockWorkerInstance;
    });
    global.Worker = workerMock as any;

    // Initialize composable - this will create a new worker via global.Worker mock
    httpStreaming = useHttpStreaming();

    // Clear the shared state BEFORE running tests, but DON'T do it after fetchQueryDataWithHttpStream
    // Note: these refs are module-level and shared across all instances
    Object.keys(httpStreaming.abortControllers.value).forEach(key => {
      delete httpStreaming.abortControllers.value[key];
    });
    Object.keys(httpStreaming.traceMap.value).forEach(key => {
      delete httpStreaming.traceMap.value[key];
    });

    onDataSpy = vi.spyOn(httpStreaming, "onData");
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  describe("initiateStreamConnection", () => {
    const mockHandlers = {
      data: vi.fn(),
      error: vi.fn(),
      complete: vi.fn(),
      reset: vi.fn(),
    };

    const mockData: any = {
        "queryReq": {
            "query": {
                "sql": "SELECT * FROM \"default\"",
                "start_time": 1750062322477000,
                "end_time": 1750062327477000,
                "size": 0,
                "sql_mode": "full",
                "track_total_hits": true
            }
        },
        "type": "search",
        "isPagination": false,
        "traceId": "0534c2294079426a86bd88b137752535",
        "org_id": "test-org",
        "searchType": "ui",
        "pageType": "logs"
    };
    it("should successfully initiate a stream connection", async () => {
        const encoder = new TextEncoder();
        const mockStream = new MockReadableStream([
          encoder.encode(''), // Empty chunk to simulate stream start
        ]);
        const mockResponse = {
          ok: true,
          body: mockStream as any,
        };

        mockFetch.mockResolvedValueOnce(mockResponse);

        await httpStreaming.fetchQueryDataWithHttpStream(mockData, mockHandlers);

        // Wait for async operations to complete
        await flushPromises();
        await nextTick();

        // Give time for the stream reading to start
        await new Promise(resolve => setTimeout(resolve, 50));

        // Ensure fetch is called correctly
        expect(mockFetch).toHaveBeenCalledWith(
          `${store.state.API_ENDPOINT}/api/test-org/_search_stream?type=logs&search_type=ui&use_cache=true`,
          expect.objectContaining({
            method: "POST",
            credentials: "include",
            headers: expect.objectContaining({
              "Content-Type": "application/json",
              traceparent: expect.any(String),
            }),
            body: JSON.stringify(mockData.queryReq),
          })
        );

        // Verify that the stream was initiated
        expect(mockFetch).toHaveBeenCalled();

        // Verify that an abort controller was created for this trace
        expect(httpStreaming.abortControllers.value[mockData.traceId]).toBeDefined();
      });

      it("should throw an error when the stream connection fails", async () => {
        const onErrorSpy = vi.spyOn(httpStreaming, "onError");

        const mockStream = new MockReadableStream();
        const mockResponse = {
            ok: false,
            status: 500,
            json: vi.fn().mockResolvedValue({ message: "Internal Server Error" }),
            body: mockStream as any,
          };

        mockFetch.mockResolvedValueOnce(mockResponse);

        await httpStreaming.fetchQueryDataWithHttpStream(mockData, mockHandlers);
        await flushPromises();
        await new Promise(resolve => setTimeout(resolve, 50));

        // Get reference to the created worker
        mockWorker = mockWorkerInstance;

        // Ensure fetch is called correctly
        expect(mockFetch).toHaveBeenCalledWith(
          `${store.state.API_ENDPOINT}/api/test-org/_search_stream?type=logs&search_type=ui&use_cache=true`,
          expect.objectContaining({
            method: "POST",
            credentials: "include",
            headers: expect.objectContaining({
              "Content-Type": "application/json",
              traceparent: expect.any(String),
            }),
            body: JSON.stringify(mockData.queryReq),
          })
        );

        if (mockWorker && mockWorker.onmessage) {
          mockWorker.onmessage({
            data: {
              type: "search_response_hits",
              traceId: mockData.traceId,
              data: { some: "mock-data" },
            },
          });

          mockWorker.onmessage({
            data: {
              type: "end",
              traceId: mockData.traceId,
              data: "end",
            },
          });
        }

        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 20));
        //this will tell us that onData have been called once
        expect(mockHandlers.data).toHaveBeenCalledTimes(0);
      });
      it("should handle AbortError correctly", async () => {
        const mockAbortError = new Error("Request aborted");
        mockAbortError.name = "AbortError";
      
        mockFetch.mockImplementationOnce(() => {
          throw mockAbortError;
        });
      
        const onErrorSpy = vi.spyOn(httpStreaming, "onError");
      
        await httpStreaming.fetchQueryDataWithHttpStream(mockData, mockHandlers);
      
        expect(onErrorSpy).not.toHaveBeenCalled(); // Should not call onError for AbortError
      });
      
      it("should call onError for non-abort errors", async () => {
        const mockNetworkError = new Error("Network failure");
      
        mockFetch.mockImplementationOnce(() => {
          throw mockNetworkError;
        });
      
        const onErrorSpy = vi.spyOn(httpStreaming, "onError");
        httpStreaming.traceMap.value[mockData.traceId] = {
          data: [],
          error: [mockHandlers.error],
          complete: [],
          reset: [],
          abortController: new AbortController()
        };

      
        await httpStreaming.fetchQueryDataWithHttpStream(mockData, mockHandlers);
        expect(mockHandlers.error).toHaveBeenCalledTimes(2);

        expect(mockHandlers.error).toHaveBeenCalledWith(mockData, {
          content: { trace_id: mockData.traceId },
          type: "error",
        });
      });
      

    
    it("should cancel the stream and clean up resources", async () => {
        const traceId = "0534c2294079426a86bd88b137752535";
        const orgId = "test-org";

        // First, trigger a stream connection to initialize the worker
        const encoder = new TextEncoder();
        const mockStream = new MockReadableStream([
          encoder.encode(''),
        ]);
        const mockResponse = {
          ok: true,
          body: mockStream as any,
        };
        mockFetch.mockResolvedValueOnce(mockResponse);

        const testData = { ...mockData, traceId };
        await httpStreaming.fetchQueryDataWithHttpStream(testData, mockHandlers);
        await flushPromises();
        await new Promise(resolve => setTimeout(resolve, 50));

        // Get reference to the created worker
        mockWorker = mockWorkerInstance;

        // Mock AbortController and add it to abortControllers
        const abortFn = vi.fn();
        const mockAbortController = { abort: abortFn };
        httpStreaming.abortControllers.value[traceId] = mockAbortController as any;

        // Ensure traceMap has the entry
        if (!httpStreaming.traceMap.value[traceId]) {
          httpStreaming.traceMap.value[traceId] = { some: "metadata" } as any;
        }

        // Clear previous postMessage calls
        if (mockWorker) {
          mockWorker.postMessage.mockClear();
        }

        // Call the cancel function
        httpStreaming.cancelStreamQueryBasedOnRequestId({
          trace_id: traceId,
          org_id: orgId,
        });

        // Assert AbortController abort was called
        expect(abortFn).toHaveBeenCalled();

        // Assert AbortController is removed
        expect(httpStreaming.abortControllers.value[traceId]).toBeUndefined();

        // Assert traceMap is cleaned
        expect(httpStreaming.traceMap.value[traceId]).toBeUndefined();

        // Assert worker postMessage was called with cancelStream
        if (mockWorker) {
          expect(mockWorker.postMessage).toHaveBeenCalledWith({
              action: 'cancelStream',
              traceId: traceId,
          });
        }
    });
    
    it("should abort all controllers, send 'closeAll' to worker, clear traceMap, and reset activeStreamId", async () => {
        const traceId1 = "0534c2294079426a86bd88b13775253115";
        const traceId2 = "0534c2294079426a86bd88b13775253116";

        // First, trigger a stream connection to initialize the worker
        const encoder = new TextEncoder();
        const mockStream = new MockReadableStream([
          encoder.encode(''),
        ]);
        const mockResponse = {
          ok: true,
          body: mockStream as any,
        };
        mockFetch.mockResolvedValueOnce(mockResponse);

        const testData = { ...mockData, traceId: traceId1 };
        await httpStreaming.fetchQueryDataWithHttpStream(testData, mockHandlers);
        await flushPromises();
        await new Promise(resolve => setTimeout(resolve, 50));

        // Get reference to the created worker
        mockWorker = mockWorkerInstance;

        // Setup mock AbortControllers
        const abortFn = vi.fn();
        const mockAbortController = { abort: abortFn };
        httpStreaming.abortControllers.value[traceId1] = mockAbortController as any;
        httpStreaming.abortControllers.value[traceId2] = mockAbortController as any;
        httpStreaming.traceMap.value[traceId1] = {some: 'metadata'};
        httpStreaming.traceMap.value[traceId2] = {some: 'metadata'};

        // Set active stream ID
        httpStreaming.activeStreamId.value = traceId1;

        // Clear previous postMessage calls
        if (mockWorker) {
          mockWorker.postMessage.mockClear();
        }

        // Call the function
        httpStreaming.closeStream();

        // Assert all abort controllers were removed
        expect(httpStreaming.abortControllers.value).toEqual({});

        // Assert 'closeAll' message was sent to worker
        if (mockWorker) {
          expect(mockWorker.postMessage).toHaveBeenCalledWith({ action: 'closeAll' });
        }

        // Assert activeStreamId was reset
        expect(httpStreaming.activeStreamId.value).toBeNull();

        // Assert traceMap was cleared
        expect(httpStreaming.traceMap.value).toEqual({});

      });
      it("should abort all controllers, send 'closeAll' to worker, clear traceMap, and reset activeStreamId (closeStreamWithError)", async () => {
        const traceId1 = "0534c2294079426a86bd88b13775253117";
        const traceId2 = "0534c2294079426a86bd88b13775253118";

        // First, trigger a stream connection to initialize the worker
        const encoder = new TextEncoder();
        const mockStream = new MockReadableStream([
          encoder.encode(''),
        ]);
        const mockResponse = {
          ok: true,
          body: mockStream as any,
        };
        mockFetch.mockResolvedValueOnce(mockResponse);

        const testData = { ...mockData, traceId: traceId1 };
        await httpStreaming.fetchQueryDataWithHttpStream(testData, mockHandlers);
        await flushPromises();
        await new Promise(resolve => setTimeout(resolve, 50));

        // Get reference to the created worker
        mockWorker = mockWorkerInstance;

        // Setup mock AbortControllers
        const abortFn = vi.fn();
        const mockAbortController = { abort: abortFn };
        httpStreaming.abortControllers.value[traceId1] = mockAbortController as any;
        httpStreaming.abortControllers.value[traceId2] = mockAbortController as any;

        httpStreaming.traceMap.value[traceId1] = {some: 'metadata'};
        httpStreaming.traceMap.value[traceId2] = {some: 'metadata'};

        // Set active stream ID
        httpStreaming.activeStreamId.value = traceId1;

        // Clear previous postMessage calls
        if (mockWorker) {
          mockWorker.postMessage.mockClear();
        }

        // Call the function under test
        httpStreaming.closeStreamWithError();

        // Assert all abort controllers were removed
        expect(httpStreaming.abortControllers.value).toEqual({});

        // Assert 'closeAll' message was sent to worker
        if (mockWorker) {
          expect(mockWorker.postMessage).toHaveBeenCalledWith({ action: 'closeAll' });
        }

        // Assert activeStreamId was reset
        expect(httpStreaming.activeStreamId.value).toBeNull();

        // Assert traceMap was cleared
        expect(httpStreaming.traceMap.value).toEqual({});
      });
       it("should convert a response with results and other fields into the expected WebSocket response format", () => {
      const traceId = "abc-123";
      const mockResponse = {
        results: [{ id: 1, name: "test" }],
        streaming_aggs: { count: 5 },
        time_offset: { minutes: 10 }
      };
      const type = "search_response_hits";

      const result = httpStreaming.convertToWsResponse(traceId, mockResponse, type);

      expect(result).toEqual({
        content: {
          results: mockResponse.results,
          streaming_aggs: mockResponse.streaming_aggs,
          time_offset: mockResponse.time_offset,
          trace_id: traceId,
        },
        type: type,
      });
    });

  it("should handle missing results and use response directly as results", () => {
    const traceId = "0534c2294079426a86bd88b13775253119";
    const mockResponse = {
      value: 42,
      streaming_aggs: null,
    };
    const type = "progress";

    const result = httpStreaming.convertToWsResponse(traceId, mockResponse, type);

    expect(result).toEqual({
      content: {
        results: mockResponse,
        streaming_aggs: mockResponse.streaming_aggs,
        time_offset: {},
        trace_id: traceId,
      },
      type: type,
    });
  });
  });
  describe("WebSocket response converters", () => {
    const traceId = "0534c2294079426a86bd88b13775253120";
  
    describe("convertToWsError", () => {
      it("should convert error response correctly", () => {
        const errorResponse = { message: "Something went wrong", code: 500 };
  
        const result = httpStreaming.convertToWsError(traceId, errorResponse);
  
        expect(result).toEqual({
          content: {
            ...errorResponse,
            trace_id: traceId,
          },
          type: "error",
        });
      });
    });
  
    describe("convertToWsEventProgress", () => {
      it("should convert progress response with percent", () => {
        const response = { percent: 75 };
  
        const result = httpStreaming.convertToWsEventProgress(traceId, response, "progress");
  
        expect(result).toEqual({
          content: {
            percent: 75,
          },
          type: "event_progress",
        });
      });
  
      it("should handle undefined percent safely", () => {
        const response = {};
  
        const result = httpStreaming.convertToWsEventProgress(traceId, response, "progress");
  
        expect(result).toEqual({
          content: {
            percent: undefined,
          },
          type: "event_progress",
        });
      });
    });
  
    describe("convertToWsEnd", () => {
      it("should convert end response properly", () => {
        const result = httpStreaming.convertToWsEnd(traceId, {}, "end");
  
        expect(result).toEqual({
          content: {
            end: true,
          },
          type: "end",
        });
      });
    });
  
    describe("wsMapper", () => {
      it("should map types to the correct converter function", () => {
        expect(httpStreaming.wsMapper["search_response_hits"]).toBe(httpStreaming.convertToWsResponse);
        expect(httpStreaming.wsMapper["search_response_metadata"]).toBe(httpStreaming.convertToWsResponse);
        expect(httpStreaming.wsMapper["progress"]).toBe(httpStreaming.convertToWsEventProgress);
        expect(httpStreaming.wsMapper["error"]).toBe(httpStreaming.convertToWsError);
        expect(httpStreaming.wsMapper["end"]).toBe(httpStreaming.convertToWsEnd);
      });
    });
  });
}); 
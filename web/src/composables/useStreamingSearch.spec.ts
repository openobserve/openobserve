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

    // Define postMessage as a method that can be spied on
    postMessage(msg: any) {
      console.log('MockWorker.postMessage called with:', msg);
      // Just track the message, don't auto-trigger responses
      // Tests will manually trigger onmessage when needed
      if(msg.action == 'cancelStream'){
        this.workerDataSent = {...msg};
      }
    }

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
    };
  }
}
let httpStreaming: any;
let mockFetch: any;
let mockWorker: MockWorker;

mockWorker = new MockWorker();
const WorkerConstructor = vi.fn().mockImplementation(() => {
  console.log('WorkerConstructor called, returning mockWorker with postMessage:', typeof mockWorker.postMessage);
  return mockWorker;
});

// Mock Worker globally - need to set it on window object directly
Object.defineProperty(window, 'Worker', {
  writable: true,
  configurable: true,
  value: WorkerConstructor
});
vi.stubGlobal('Worker', WorkerConstructor);

import useHttpStreaming from "./useStreamingSearch";

describe("useHttpStreaming", () => {

let onDataSpy: any;

  beforeEach(async () => {
    // Reset modules to clear the module-scoped streamWorker variable
    vi.resetModules();

    vi.clearAllMocks();

    // Set Worker on window in beforeEach to ensure it's available
    Object.defineProperty(window, 'Worker', {
      writable: true,
      configurable: true,
      value: WorkerConstructor
    });

    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Reset the mock worker and spy on postMessage BEFORE creating worker
    mockWorker.onmessage = null;
    vi.spyOn(mockWorker, 'postMessage');
    WorkerConstructor.mockClear();

    // Re-import the composable after resetting modules
    const useStreamingSearchModule = await import("./useStreamingSearch");
    const useHttpStreamingFn = useStreamingSearchModule.default;

    // Initialize composable
    httpStreaming = useHttpStreamingFn();

    // IMPORTANT: mock these if your composable uses `ref({})` internally
    httpStreaming.abortControllers.value = {};
    httpStreaming.traceMap.value = {};
    onDataSpy = vi.spyOn(httpStreaming, "onData");
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Clean up Worker mock
    // @ts-ignore - Cleaning up window.Worker
    delete global.Worker;
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
    // TODO: Fix Worker mocking - the module-scoped streamWorker variable makes it difficult to properly mock
    it.skip("should successfully initiate a stream connection", async () => {
        const onErrorSpy = vi.spyOn(httpStreaming, "onError");

        const mockStream = new MockReadableStream();
        const mockResponse = {
          ok: true,
          body: mockStream as any,
        };

        mockFetch.mockResolvedValueOnce(mockResponse);

        // Start the stream connection
        const streamPromise = httpStreaming.fetchQueryDataWithHttpStream(mockData, mockHandlers);

        // Wait for the worker to be set up
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Now trigger worker messages after the worker's onmessage handler is set
        if (mockWorker.onmessage) {
          mockWorker.onmessage({
            data: {
              type: "search_response_hits",
              traceId: mockData.traceId,
              data: { some: "mock-data" },
            },
          } as any);

          mockWorker.onmessage({
            data: {
              type: "end",
              traceId: mockData.traceId,
              data: "end",
            },
          } as any);
        }

        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 100));

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

        //this will tell us that onData have been called once
        expect(mockHandlers.data).toHaveBeenCalledTimes(1);

        await streamPromise;
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
      
        mockWorker.onmessage?.({
          data: {
            type: "search_response_hits",
            traceId: mockData.traceId,
            data: { some: "mock-data" },
          },
        });
      
        mockWorker.onmessage?.({
          data: {
            type: "end",
            traceId: mockData.traceId,
            data: "end",
          },
        });

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
      

    
    // TODO: Fix Worker mocking
    it.skip("should cancel the stream and clean up resources", async () => {
        const traceId = "0534c2294079426a86bd88b137752535";
        const orgId = "test-org";

        // First, initialize a stream to create the worker
        const mockStream = new MockReadableStream();
        const mockResponse = {
          ok: true,
          body: mockStream as any,
        };
        mockFetch.mockResolvedValueOnce(mockResponse);

        console.log('typeof window:', typeof window);
        console.log('window.Worker:', window.Worker);
        console.log('Before fetchQueryDataWithHttpStream, window.Worker:', typeof window?.Worker);

        const streamData = { ...mockData, traceId };
        const streamPromise = httpStreaming.fetchQueryDataWithHttpStream(streamData, mockHandlers);

        // Wait for worker to be initialized
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 50));

        console.log('After fetchQueryDataWithHttpStream');
        console.log('WorkerConstructor calls:', WorkerConstructor.mock.calls.length);
        console.log('mockWorker.postMessage calls:', mockWorker.postMessage.mock.calls.length);
        console.log('All postMessage calls:', JSON.stringify(mockWorker.postMessage.mock.calls));

        // Mock AbortController and add it to abortControllers
        const abortFn = vi.fn();
        const mockAbortController = { abort: abortFn };
        httpStreaming.abortControllers.value[traceId] = mockAbortController as any;

        // Add to traceMap
        httpStreaming.traceMap.value[traceId] = { some: "metadata" } as any;

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

        // Assert worker received cancel message
        // Check the most recent postMessage call after startStream
        await flushPromises();

        const cancelCall = mockWorker.postMessage.mock.calls.find((call: any) => call[0]?.action === 'cancelStream');
        expect(cancelCall, `postMessage was called ${mockWorker.postMessage.mock.calls.length} times with: ${JSON.stringify(mockWorker.postMessage.mock.calls)}`).toBeDefined();
        expect(cancelCall[0]).toEqual({
          action: 'cancelStream',
          traceId: traceId,
        });
    });
    
    // TODO: Fix Worker mocking
    it.skip("should abort all controllers, send 'closeAll' to worker, clear traceMap, and reset activeStreamId", async () => {
        const traceId1 = "0534c2294079426a86bd88b13775253115";
        const traceId2 = "0534c2294079426a86bd88b13775253116";

        // First, initialize a stream to create the worker
        const mockStream = new MockReadableStream();
        const mockResponse = {
          ok: true,
          body: mockStream as any,
        };
        mockFetch.mockResolvedValueOnce(mockResponse);

        const streamData = { ...mockData, traceId: traceId1 };
        const streamPromise = httpStreaming.fetchQueryDataWithHttpStream(streamData, mockHandlers);

        // Wait for worker to be initialized
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Setup mock AbortControllers
        const abortFn = vi.fn();
        const mockAbortController = { abort: abortFn };
        httpStreaming.abortControllers.value[traceId1] = mockAbortController as any;
        httpStreaming.abortControllers.value[traceId2] = mockAbortController as any;
        httpStreaming.traceMap.value[traceId1] = {some: 'metadata'};
        httpStreaming.traceMap.value[traceId2] = {some: 'metadata'};

        // Set active stream ID
        httpStreaming.activeStreamId.value = traceId1;

        // Call the function
        httpStreaming.closeStream();

        // Assert 'closeAll' message was sent to worker
        const closeAllCall = mockWorker.postMessage.mock.calls.find((call: any) => call[0].action === 'closeAll');
        expect(closeAllCall).toBeDefined();
        expect(closeAllCall[0]).toEqual({ action: 'closeAll' });

        // Assert all abort controllers were removed
        expect(httpStreaming.abortControllers.value).toEqual({});

        // Assert activeStreamId was reset
        expect(httpStreaming.activeStreamId.value).toBeNull();

        // Assert traceMap was cleared
        expect(httpStreaming.traceMap.value).toEqual({});

      });
      // TODO: Fix Worker mocking
      it.skip("should abort all controllers, send 'closeAll' to worker, clear traceMap, and reset activeStreamId (closeStreamWithError)", async () => {
        const traceId1 = "0534c2294079426a86bd88b13775253117";
        const traceId2 = "0534c2294079426a86bd88b13775253118";

        // First, initialize a stream to create the worker
        const mockStream = new MockReadableStream();
        const mockResponse = {
          ok: true,
          body: mockStream as any,
        };
        mockFetch.mockResolvedValueOnce(mockResponse);

        const streamData = { ...mockData, traceId: traceId1 };
        const streamPromise = httpStreaming.fetchQueryDataWithHttpStream(streamData, mockHandlers);

        // Wait for worker to be initialized
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Setup mock AbortControllers
        const abortFn = vi.fn();
        const mockAbortController = { abort: abortFn };
        httpStreaming.abortControllers.value[traceId1] = mockAbortController as any;
        httpStreaming.abortControllers.value[traceId2] = mockAbortController as any;

        httpStreaming.traceMap.value[traceId1] = {some: 'metadata'};
        httpStreaming.traceMap.value[traceId2] = {some: 'metadata'};

        // Set active stream ID
        httpStreaming.activeStreamId.value = traceId1;

        // Call the function under test
        httpStreaming.closeStreamWithError();

        // Assert 'closeAll' message was sent to worker
        const closeAllCall = mockWorker.postMessage.mock.calls.find((call: any) => call[0].action === 'closeAll');
        expect(closeAllCall).toBeDefined();
        expect(closeAllCall[0]).toEqual({ action: 'closeAll' });

        // Assert all abort controllers were removed
        expect(httpStreaming.abortControllers.value).toEqual({});

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
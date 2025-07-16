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

import { ref } from "vue";
import type { SearchRequestPayload } from "@/ts/interfaces";
import authService from "@/services/auth";
import store from "@/stores";
import { getUUID } from "@/utils/zincutils";

// Create and manage stream workers
let streamWorker: Worker | null = null;
const createStreamWorker = () => {
  if (!streamWorker && window.Worker) {
    streamWorker = new Worker(new URL('../workers/streamWorker.js', import.meta.url), { type: 'module' });
  }
  return streamWorker;
};

// Type definitions similar to WebSocket but for HTTP/2 streaming
type StreamHandler = (data: any, traceId: string) => void;
type ErrorHandler = (error: any, traceId: string) => void;
type CompleteHandler = (traceId: string) => void;
type ResetHandler = (data: any, traceId: string) => void;

type TraceRecord = {
  data: StreamHandler[];
  error: ErrorHandler[];
  complete: CompleteHandler[];
  reset: ResetHandler[];
  isInitiated: boolean;
  streamId: string | null;
  abortController: AbortController | null;
  requestData: any;
};

const traceMap = ref<Record<string, TraceRecord>>({});
const activeStreamId = ref<string | null>(null);
const streamConnections = ref<Record<string, ReadableStreamDefaultReader<Uint8Array>>>({});
const abortControllers = ref<Record<string, AbortController>>({});
const errorOccurred = ref(false);

type StreamResponseType = 'search_response_metadata' | 'search_response_hits' | 'progress' | 'error' | 'end';

const useHttpStreaming = () => {
  const onData = (traceId: string, type: StreamResponseType | 'end', response: any) => {
    if (!traceMap.value[traceId]) return;

    if (response === 'end' || response === '[[DONE]]') {
      for (const handler of traceMap.value[traceId].complete) {
        handler(traceId);
      }
      cleanUpListeners(traceId);
      return
    }

    if (typeof response === 'string') {
      response = JSON.parse(response);
    }

    const wsResponse = wsMapper[type as StreamResponseType](traceId, response, type);


    for (const handler of traceMap.value[traceId].data) {
      handler(wsResponse, traceId);
    }
  };

  const onComplete = (traceId: string) => {
    if (!traceMap.value[traceId]) return;

    for (const handler of traceMap.value[traceId].complete) {
      handler(traceId);
    }
  };

  const onError = async (traceId: string, error: any) => {
    if (!traceMap.value[traceId]) return;

    errorOccurred.value = true;
    
    const response = convertToWsError(traceId, error);

    for (const handler of traceMap.value[traceId].error) {
      handler(response, traceId);
    }

    cleanUpListeners(traceId);

  };

  const onReset = (data: any, traceId: string) => {
    if (!traceMap.value[traceId]) return;

    for (const handler of traceMap.value[traceId].reset) {
      handler(data, traceId);
    }
  };

  const fetchQueryDataWithHttpStream = async (
    data: {
      queryReq: SearchRequestPayload;
      type: "search" | "histogram" | "pageCount" | "values";
      traceId: string;
      org_id: string;
      pageType: string;
      searchType: string;
      meta: any;
    },
    handlers: {
      data: (data: any, response: any) => void;
      error: (data: any, response: any) => void;
      complete: (data: any, response: any) => void;
      reset: (data: any, response: any) => void;
    }
  ) => {
    const { traceId, org_id } = data;

    if (!traceMap.value[traceId]) {
      traceMap.value[traceId] = {
        data: [],
        error: [],
        complete: [],
        reset: [],
        isInitiated: false,
        streamId: null,
        abortController: null,
        requestData: { ...data }
      };
    }

    // Register handlers for this trace ID
    traceMap.value[traceId].data.push((res) => handlers.data(data, res));
    traceMap.value[traceId].error.push((err) => handlers.error(data, err));
    traceMap.value[traceId].complete.push((_) => handlers.complete(data, _));
    traceMap.value[traceId].reset.push((res) => handlers.reset(data, res));

    // If the stream connection is already initiated for this trace, exit early
    if (traceMap.value[traceId].isInitiated) {
      return;
    }

    // Mark this trace as initiated
    traceMap.value[traceId].isInitiated = true;

    // Initiate the HTTP/2 stream connection
    initiateStreamConnection(data, handlers);
  };

  const initiateStreamConnection = async (
    data: {
      queryReq: SearchRequestPayload;
      type: "search" | "histogram" | "pageCount" | "values";
      traceId: string;
      org_id: string;
      pageType: string;
      searchType: string;
      meta: any;
    },
    handlers: {
      data: (data: any, response: any) => void;
      error: (data: any, response: any) => void;
      complete: (data: any, response: any) => void;
      reset: (data: any, response: any) => void;
    }
  ) => {
    const { traceId, org_id, type, queryReq, searchType, pageType, meta } = data;
    const abortController = new AbortController();

    // Store the abort controller for this trace
    abortControllers.value[traceId] = abortController;
    traceMap.value[traceId].abortController = abortController;

    // Construct URL based on search type
    let url = '';
    const use_cache = (window as any).use_cache !== undefined
      ? (window as any).use_cache
      : true;

      //TODO OK: Create method to get the url based on the type
      if(type === "search" || type === "histogram" || type === "pageCount") {
        url = `/_search_stream?type=${pageType}&search_type=${searchType}&use_cache=${use_cache}`;
        if (meta?.dashboard_id) url += `&dashboard_id=${meta?.dashboard_id}`;
        if (meta?.folder_id) url += `&folder_id=${meta?.folder_id}`;
        if (meta?.fallback_order_by_col) url += `&fallback_order_by_col=${meta?.fallback_order_by_col}`;
      } else if(type === "values") {
        const fieldsString = meta?.fields.join(",");
        url = `/_values_stream`
      }

    url = `${store.state.API_ENDPOINT}/api/${org_id}` + url;

    try {
      const spanId = getUUID().replace(/-/g, "").slice(0, 16);
      const traceparent = `00-${traceId}-${spanId}-01`;
      // Make the HTTP/2 streaming request
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'traceparent': traceparent,
        },
        body: JSON.stringify(queryReq),
        signal: abortController.signal,
      });

      if (!response.ok) {
        onError(traceId, {
          status: response.status,
          ...(await response.json()),
        });
        return;
      }

      // Set up worker for stream processing
      const worker = createStreamWorker();
      
      if(worker) {
      // Set up worker message handling
        worker.onmessage = (event) => {
          const { type, traceId: eventTraceId, data } = event.data;
          switch (type) {
            case 'search_response_metadata':
              onData(eventTraceId, 'search_response_metadata', data);
              break;
            case 'search_response_hits':
              onData(eventTraceId, 'search_response_hits', data);
              break;
            case 'progress':
              onData(eventTraceId, 'progress', data);
              break;
            case 'error':
              onError(eventTraceId, data);
              break;
            case 'end':
              onData(eventTraceId, 'end', 'end');
              break;
          }
        };
      } else {
        throw new Error('Worker is not supported');
      }


      // Get the ReadableStream
      const readableStream = response.body;

      if (!readableStream) {
        throw new Error('Response body is null');
      }
      
      // Start the stream in the worker
      if (worker) {        
        // Initialize the stream in the worker
        worker.postMessage({
          action: 'startStream',
          traceId
        });
        
        // For Safari compatibility: manually read the stream and send chunks to worker
        const reader = readableStream.getReader();
        const decoder = new TextDecoder();
        
        (async () => {
          try {
            while (true) {
              // Check if this trace is still active before reading
              if (!traceMap.value[traceId]) {
                // console.log('Trace no longer active, stopping stream reading for traceId:', traceId);
                break;
              }
              
              const { done, value } = await reader.read();
              
              if (done) {
                worker.postMessage({
                  action: 'endStream',
                  traceId
                });
                break;
              }
              
              // Check again before processing the chunk
              if (!traceMap.value[traceId]) {
                // console.log('Trace cancelled during processing, skipping chunk for traceId:', traceId);
                break;
              }
              
              // Decode and send chunks to the worker
              const chunk = decoder.decode(value, { stream: true });
              worker.postMessage({
                action: 'processChunk',
                traceId,
                chunk
              });
            }
          } catch (error) {
            // Handle AbortError gracefully - this is expected when stream is cancelled
            if ((error as any).name === 'AbortError') {
              // console.log('Stream reading was cancelled for traceId:', traceId);
              // Don't call onError for expected cancellations
            } else {
              console.error('Error reading stream:', error);
              onError(traceId, error);
            }
          } finally {
            // Always release the reader lock to prevent resource leaks
            try {
              reader.releaseLock();
            } catch (releaseError) {
              // Ignore errors when releasing lock on already aborted stream
              // console.log('Reader lock already released for traceId:', traceId);
            }
          }
        })();
      } else {
        throw new Error('Worker is not supported');
      }
      
      // Store reference to abort controller for cancellation
      activeStreamId.value = traceId;
      
    } catch (error) {
      if ((error as any).name === 'AbortError') {
       // console.error('Stream was canceled');
      } else {
        onError(traceId, error);
      }
    }
  };

  const cancelStreamQueryBasedOnRequestId = (payload: {
    trace_id: string;
    org_id: string;
  }) => {
    const { trace_id } = payload;

    // Check if this trace is still active before attempting cancellation
    if (!traceMap.value[trace_id]) {
      // console.log('Trace already cleaned up for traceId:', trace_id);
      return;
    }

    if (abortControllers.value[trace_id]) {
      abortControllers.value[trace_id].abort();
      delete abortControllers.value[trace_id];
    }

    // Also cancel in worker
    if (streamWorker) {
      streamWorker.postMessage({
        action: 'cancelStream',
        traceId: trace_id
      });
    }

    cleanUpListeners(trace_id);
  };

  const cleanUpListeners = (traceId: string) => {
    if (traceMap.value[traceId]) {
      delete traceMap.value[traceId];
    }
  };

  const closeStreamWithError = () => {
    Object.keys(abortControllers.value).forEach((traceId) => {
      abortControllers.value[traceId].abort();
      delete abortControllers.value[traceId];
    });

    // Close all streams in worker
    if (streamWorker) {
      streamWorker.postMessage({
        action: 'closeAll'
      });
    }

    Object.keys(traceMap.value).forEach((traceId) => {
      delete traceMap.value[traceId];
    });

    activeStreamId.value = null;
  };

  const closeStream = () => {
    Object.keys(abortControllers.value).forEach((traceId) => {
      abortControllers.value[traceId].abort();
      delete abortControllers.value[traceId];
    });

    // Close all streams in worker
    if (streamWorker) {
      streamWorker.postMessage({
        action: 'closeAll'
      });
    }

    Object.keys(traceMap.value).forEach((traceId) => {
      delete traceMap.value[traceId];
    });

    activeStreamId.value = null;
  };

  const resetAuthToken = async () => {
    await authService.refresh_token();
  };


  const convertToWsResponse = (traceId: string, response: any, type: StreamResponseType) => {

    let resp = {
      content: {
        results: response.results || response,
        streaming_aggs: response.streaming_aggs,
        time_offset: response?.time_offset || {},
        trace_id: traceId,
      },
      type: type,
    };
    return resp;
  }

  const convertToWsError = (traceId: string, response: any) => {
    return {
      content: {
        ...response,
        trace_id: traceId,
      },
      type: "error",
    }
  }

  const convertToWsEventProgress = (traceId: string, response: any, type: StreamResponseType) => {
    return {
      content: {
        percent: response?.percent,
      },
      type: "event_progress",
    }
  }

  const convertToWsEnd = (traceId: string, response: any, type: StreamResponseType) => {
    return {
      content: {
        end: true,
      },
      type: "end",
    }
  }

  const wsMapper = {
    'search_response_metadata': convertToWsResponse,
    'search_response_hits': convertToWsResponse,
    'progress': convertToWsEventProgress,
    'error': convertToWsError,
    'end': convertToWsEnd,
  }

  return {
    fetchQueryDataWithHttpStream,
    cancelStreamQueryBasedOnRequestId,
    closeStreamWithError,
    closeStream,
    resetAuthToken,
    onData,
    abortControllers,
    traceMap,
    activeStreamId,
    streamConnections,
    errorOccurred,
    convertToWsResponse,
    convertToWsError,
    convertToWsEventProgress,
    convertToWsEnd,
    wsMapper,
    onError,
  };
};

export default useHttpStreaming; 
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
import { useStore } from "vuex";

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

const useHttpStreaming = () => {

  const onData = (traceId: string, type: 'search_response' | 'error', response: any) => {
    if (!traceMap.value[traceId]) return;
    response = JSON.parse(response);
    const wsMapper = {
      'search_response': convertToWsResponse,
      'error': convertToWsError,
    }

    console.log('onData', traceId, type, response);

    const wsResponse = wsMapper[type](traceId, response);

    if (response === 'end') {
      for (const handler of traceMap.value[traceId].complete) {
        handler(traceId);
      }

      return
    }

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

  const onError = async (error: any, traceId: string) => {
    console.log('onError', error, traceId);

    if (!traceMap.value[traceId]) return;

    errorOccurred.value = true;

    for (const handler of traceMap.value[traceId].error) {
      handler(error, traceId);
    }
  };

  const onReset = (data: any, traceId: string) => {
    if (!traceMap.value[traceId]) return;

    for (const handler of traceMap.value[traceId].reset) {
      handler(data, traceId);
    }
  };

  // Creates an HTTP/2 streaming connection to the server
  const createStreamConnection = (org_id: string) => {
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    return `${protocol}//localhost:5080/api/${org_id}`;
  };

  const fetchQueryDataWithHttpStream = async (
    data: {
      queryReq: SearchRequestPayload;
      type: "search" | "histogram" | "pageCount" | "values";
      isPagination: boolean;
      traceId: string;
      org_id: string;
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
      isPagination: boolean;
      traceId: string;
      org_id: string;
    },
    handlers: {
      data: (data: any, response: any) => void;
      error: (data: any, response: any) => void;
      complete: (data: any, response: any) => void;
      reset: (data: any, response: any) => void;
    }
  ) => {
    const { traceId, org_id, type, queryReq } = data;
    const baseUrl = createStreamConnection(org_id);
    const searchType = type;
    const abortController = new AbortController();

    // Store the abort controller for this trace
    abortControllers.value[traceId] = abortController;
    traceMap.value[traceId].abortController = abortController;

    // Construct URL based on search type
    let url = '';
    const use_cache = (window as any).use_cache !== undefined
      ? (window as any).use_cache
      : true;
    if (searchType === 'search' || searchType === 'histogram' || searchType === 'pageCount') {
      url = `${baseUrl}/_search_stream?type=logs&search_type=ui&use_cache=${use_cache}`;
    } else if (searchType === 'values') {
      url = `${baseUrl}/_search_values_stream?type=logs&search_type=ui`;
    }

    try {
      // Make the HTTP/2 streaming request
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'traceparent': '',
        },
        body: JSON.stringify(queryReq),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (!response.ok) {
        throw new Error('Failed to start stream');
      }

      let messages: string[] = [];

      let error = '';

      const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array>;
      const decoder = new TextDecoder();
      streamConnections.value[traceId] = reader;
      activeStreamId.value = traceId;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log(`Stream ended for user ${traceId}`);
          onData(traceId, 'search_response', 'end');
          break;
        }

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            // Try to parse as JSON first (error case)
            const json = JSON.parse(line);
            if (json.code > 200) {
              error = json.message;
              break;
            } else {
              onData(traceId, 'search_response', json);
            }
          } catch (e) {
            // If not JSON, check if it's an SSE message
            if (line.startsWith('data: ')) {
              onData(traceId, 'search_response', line.slice(6));
            }
          }
        }
      }

      console.log('messages', messages);

      // if (!response.body) {
      //   throw new Error('Response body is null');
      // }

      // // Get the readable stream from the response body
      // const reader = response.body.getReader();
      // streamConnections.value[traceId] = reader;
      // activeStreamId.value = traceId;

      // // Process the stream
      // const decoder = new TextDecoder('utf-8');
      // let buffer = '';

      // while (true) {
      //   const { value, done } = await reader.read();

      //   if (done) {
      //     // Process any remaining buffer data
      //     if (buffer.length > 0) {
      //       try {
      //         const jsonData = JSON.parse(buffer);
      //         onData(jsonData, traceId);
      //       } catch (e) {
      //         console.error('Error parsing JSON from stream buffer', e);
      //       }
      //     }
      //     onComplete(traceId);
      //     break;
      //   }

      //   // Decode the chunk and add to buffer
      //   const chunk = decoder.decode(value, { stream: true });
      //   buffer += chunk;

      //   // Process complete JSON objects from the buffer
      //   let newlineIndex;
      //   while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      //     const jsonString = buffer.slice(0, newlineIndex);
      //     buffer = buffer.slice(newlineIndex + 1);

      //     try {
      //       const jsonData = JSON.parse(jsonString);
      //       onData(jsonData, traceId);
      //     } catch (e) {
      //       console.error('Error parsing JSON from stream', e);
      //     }
      //   }
      // }
    } catch (error) {
      if ((error as any).name === 'AbortError') {
        console.log('Stream was canceled');
      } else {
        onError(error, traceId);
      }
    } finally {
      delete streamConnections.value[traceId];
      delete abortControllers.value[traceId];
      if (activeStreamId.value === traceId) {
        activeStreamId.value = null;
      }
    }
  };

  const cancelStreamQueryBasedOnRequestId = (payload: {
    trace_id: string;
    org_id: string;
  }) => {
    const { trace_id } = payload;

    if (abortControllers.value[trace_id]) {
      abortControllers.value[trace_id].abort();
      delete abortControllers.value[trace_id];
    }

    if (streamConnections.value[trace_id]) {
      delete streamConnections.value[trace_id];
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

    Object.keys(streamConnections.value).forEach((traceId) => {
      delete streamConnections.value[traceId];
    });

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

    Object.keys(streamConnections.value).forEach((traceId) => {
      delete streamConnections.value[traceId];
    });

    Object.keys(traceMap.value).forEach((traceId) => {
      delete traceMap.value[traceId];
    });

    activeStreamId.value = null;
  };

  const resetAuthToken = async () => {
    await authService.refresh_token();
  };


  const convertToWsResponse = (traceId: string, response: any) => {

    let resp = {
      content: {
        results: response.SearchResponse.results,
        streaming_aggs: response.SearchResponse.streaming_aggs,
        trace_id: traceId,
      },
      type: "search_response",
    };
    return resp;
  }

  const convertToWsError = (traceId: string, response: any) => {
    return {
      content: {
        error: response.error,
        trace_id: traceId,
      },
      type: "error",
    }
  }

  return {
    fetchQueryDataWithHttpStream,
    cancelStreamQueryBasedOnRequestId,
    closeStreamWithError,
    closeStream,
    resetAuthToken,
  };
};

export default useHttpStreaming; 
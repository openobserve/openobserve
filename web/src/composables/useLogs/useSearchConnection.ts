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

import { searchState } from "@/composables/useLogs/searchState";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import useNotifications from "@/composables/useNotifications";
import useSearchWebSocket from "@/composables/useSearchWebSocket";
import useStreamingSearch from "@/composables/useStreamingSearch";
import { useStore } from "vuex";
import {
  SearchRequestPayload,
  WebSocketSearchPayload,
} from "@/ts/interfaces/query";
import { generateTraceContext } from "@/utils/zincutils";

export const useSearchConnection = () => {
  const { showErrorNotification } = useNotifications();
  const { addTraceId, removeTraceId } = logsUtils();
  const store = useStore();
  const { searchObj, notificationMsg, searchPartitionMap } = searchState();

  const {
    fetchQueryDataWithWebSocket,
    sendSearchMessageBasedOnRequestId,
    closeSocketBasedOnRequestId,
  } = useSearchWebSocket();

  const { fetchQueryDataWithHttpStream } = useStreamingSearch();

  const buildWebSocketPayload = (
    queryReq: SearchRequestPayload,
    isPagination: boolean,
    type: "search" | "histogram" | "pageCount" | "values",
    meta?: any,
    clear_cache?: boolean,
  ) => {
    const { traceId } = generateTraceContext();
    addTraceId(traceId);

    const payload: {
      queryReq: SearchRequestPayload;
      type: "search" | "histogram" | "pageCount" | "values";
      isPagination: boolean;
      traceId: string;
      org_id: string;
      meta?: any;
      clear_cache?: boolean;
    } = {
      queryReq,
      type,
      isPagination,
      traceId,
      org_id: searchObj.organizationIdentifier,
      meta,
      clear_cache: clear_cache,
    };

    return payload;
  };

  const initializeSearchConnection = (
    payload: any,
  ): string | Promise<void> | null => {
      payload.searchType = "ui";
      payload.pageType = searchObj.data.stream.streamType;
      return fetchQueryDataWithHttpStream(payload, {
        data: (payload: any, response: any) => {
          if (payload.onData) payload.onData(payload, response);
        },
        error: (payload: any, error: any) => {
          if (payload.onError) payload.onError(payload, error);
        },
        complete: (payload: any, response: any) => {
          if (payload.onComplete) payload.onComplete(payload, response);
        },
        reset: (data: any, traceId?: string) => {
          if (payload.onReset) payload.onReset(data, traceId);
        },
      }) as Promise<void>;
  };

  const sendSearchMessage = (queryReq: any) => {
    try {
      if (searchObj.data.isOperationCancelled) {
        closeSocketBasedOnRequestId(queryReq.traceId);
        return;
      }

      const payload = {
        type: "search",
        content: {
          trace_id: queryReq.traceId,
          payload: {
            query: queryReq.queryReq.query,
            ...(store.state.zoConfig.sql_base64_enabled
              ? { encoding: "base64" }
              : {}),
          } as SearchRequestPayload,
          stream_type: searchObj.data.stream.streamType,
          search_type: "ui",
          use_cache: (window as any).use_cache ?? true,
          org_id: searchObj.organizationIdentifier,
        },
      };

      if (
        Object.hasOwn(queryReq.queryReq, "regions") &&
        Object.hasOwn(queryReq.queryReq, "clusters")
      ) {
        payload.content.payload["regions"] = queryReq.queryReq.regions;
        payload.content.payload["clusters"] = queryReq.queryReq.clusters;
      }

      sendSearchMessageBasedOnRequestId(payload);
    } catch (e: any) {
      searchObj.loading = false;
      showErrorNotification(
        notificationMsg.value || "Error occurred while sending socket message.",
      );
      notificationMsg.value = "";
    }
  };

  const getDataThroughStream = (
    queryReq: SearchRequestPayload,
    isPagination: boolean,
    callbacks: {
      onData: (payload: WebSocketSearchPayload, response: any) => void;
      onError: (payload: any, error: any) => void;
      onComplete: (payload: any, response: any) => void;
      onReset: (data: any, traceId?: string) => void;
    },
  ) => {
    try {
      if (!queryReq) return;

      if (!isPagination && searchObj.meta.refreshInterval == 0) {
        searchObj.data.queryResults.hits = [];
        searchObj.data.histogram = {
          xData: [],
          yData: [],
          chartParams: {
            title: "",
            unparsed_x_data: [],
            timezone: "",
          },
          errorCode: 0,
          errorMsg: "",
          errorDetail: "",
        };
      }

      const payload = buildWebSocketPayload(queryReq, isPagination, "search", {}, searchObj.meta.clearCache);

      // Add callbacks to payload
      payload.onData = callbacks.onData;
      payload.onError = callbacks.onError;
      payload.onComplete = callbacks.onComplete;
      payload.onReset = callbacks.onReset;

      if (shouldGetPageCount(queryReq) && searchObj.meta.refreshInterval == 0) {
        queryReq.query.size = queryReq.query.size + 1;
      }

      // in case of live refresh, reset from to 0
      if (
        searchObj.meta.refreshInterval > 0 &&
        window.location.pathname.includes("logs")
      ) {
        queryReq.query.from = 0;
        searchObj.meta.refreshHistogram = false;
      }
      
      const requestId = initializeSearchConnection(payload);

      if (!requestId) {
        throw new Error(
          `Failed to initialize ${searchObj.communicationMethod} connection`,
        );
      }

      addTraceId(payload.traceId);
    } catch (e: any) {
      console.error(
        `Error while getting data through ${searchObj.communicationMethod}`,
        e,
      );
      searchObj.loading = false;
      showErrorNotification(
        notificationMsg.value || "Error occurred during the search operation.",
      );
      notificationMsg.value = "";
    }
  };

  const shouldGetPageCount = (queryReq: SearchRequestPayload): boolean => {
    // This is a simplified version - you may need to import the full logic
    return queryReq.query.size > 0 && !queryReq.query.sql?.includes("LIMIT");
  };

  const cleanupConnection = (traceId: string) => {
    removeTraceId(traceId);
    if (searchPartitionMap[traceId]) {
      delete searchPartitionMap[traceId];
    }
  };

  return {
    buildWebSocketPayload,
    initializeSearchConnection,
    sendSearchMessage,
    getDataThroughStream,
    cleanupConnection,
  };
};

export default useSearchConnection;

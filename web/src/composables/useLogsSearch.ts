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

import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { ref, reactive } from "vue";
import type { SearchRequestPayload, WebSocketSearchPayload, WebSocketSearchResponse } from "@/ts/interfaces";
import { logsApi } from "@/services/logs/logsApi";
import { savedViewsApi } from "@/services/logs/savedViewsApi";
import useSearchWebSocket from "@/composables/useSearchWebSocket";
import useQuery from "@/composables/useQuery";
import { useLogsState } from "@/composables/useLogsState";
import {
  fnParsedSQL,
  fnUnparsedSQL,
  generateURLQueryUtil,
  buildWebSocketPayloadUtil,
  hasAggregation,
  extractValueQueryUtil,
} from "@/utils/logs/parsers";
import {
  MAX_SEARCH_RETRIES,
  SEARCH_RECONNECT_DELAY,
} from "@/utils/logs/constants";
import { showErrorNotification } from "@/utils/common";

interface URLQueryParams {
  [key: string]: any;
}

interface QueryTransformParams {
  [key: string]: any;
}

interface ValueQueryParams {
  [key: string]: any;
}

/**
 * Search operations composable for logs functionality
 * Contains all search-related operations including query building, execution, and WebSocket handling
 */
export const useLogsSearch = () => {
  const store = useStore();
  const router = useRouter();
  const $q = useQuasar();
  const { buildQueryPayload, getTimeInterval } = useQuery();
  const {
    fetchQueryDataWithWebSocket,
    sendSearchMessageBasedOnRequestId,
    cancelSearchQueryBasedOnRequestId,
    closeSocketBasedOnRequestId,
  } = useSearchWebSocket();
  const { 
    searchObj, 
    searchAggData, 
    searchObjDebug,
    initialQueryPayload,
    streamSchemaFieldsIndexMapping 
  } = useLogsState();

  // Search partition mapping
  const searchPartitionMap = reactive<{ [key: string]: number }>({});

  /**
   * Build search query request
   */
  const buildSearch = () => {
    const identifier: string = searchObj.organizationIdentifier || "default";
    
    try {
      const timestamps: any = searchObj.data.datetime.type === "relative"
        ? getTimeInterval(searchObj.data.datetime.relativeTimePeriod)
        : searchObj.data.datetime.type === "absolute"
        ? {
            start_time: searchObj.data.datetime.startTime,
            end_time: searchObj.data.datetime.endTime,
          }
        : { start_time: 0, end_time: 0 };

      let query = "";
      const queryReq = JSON.parse(JSON.stringify(searchObj.data.query));
      
      if (queryReq !== "") {
        const parseQuery = queryReq.split("|");
        const queryFunctions = parseQuery.length > 1 ? "," + parseQuery[0].trim() : "";
        query = parseQuery.length > 1 ? parseQuery[1].trim() : parseQuery[0];

        if (queryFunctions !== "" && queryFunctions !== "," && !searchObj.meta.sqlMode) {
          query = query.replace("SELECT *", "SELECT " + queryFunctions);

          for (const field of searchObj.data.stream.selectedStreamFields) {
            if (field.name === queryFunctions.replaceAll(",", "")) {
              break;
            }
          }
        }
      }

      const queryPayloadData = {
        org_identifier: identifier,
        query: {
          sql: query,
          start_time: timestamps.start_time,
          end_time: timestamps.end_time,
          from: 0,
          size: searchObj.meta.resultGrid.rowsPerPage,
          quick_mode: searchObj.meta.quickMode,
          track_total_hits: searchObj.data.countEnabled,
          sql_mode: searchObj.meta.sqlMode,
          query_type: "",
        },
        aggs: {
          histogram: `SELECT histogram(_timestamp, '${searchObj.meta.resultGrid.chartInterval}') AS zo_sql_key, count(*) AS zo_sql_num FROM query GROUP BY zo_sql_key ORDER BY zo_sql_key`,
        },
        encoding: "base64",
      };

      const req = buildQueryPayload(queryPayloadData);
      
      if (searchObj.meta.regions?.length) {
        req.regions = searchObj.meta.regions;
      }
      
      return req;
    } catch (error: any) {
      console.error("Error in buildSearch:", error);
      throw new Error("An error occurred while constructing the search query.");
    }
  };

  /**
   * Check if query is a LIMIT query
   */
  const isLimitQuery = (parsedSQL: any = null) => {
    const parsed = parsedSQL || fnParsedSQL(searchObj.data.query);
    return parsed?.limit != null;
  };

  /**
   * Check if query is a DISTINCT query
   */
  const isDistinctQuery = (parsedSQL: any = null) => {
    const parsed = parsedSQL || fnParsedSQL(searchObj.data.query);
    return parsed?.distinct != null;
  };

  /**
   * Check if query is a WITH query
   */
  const isWithQuery = (parsedSQL: any = null) => {
    const parsed = parsedSQL || fnParsedSQL(searchObj.data.query);
    return parsed?.with != null;
  };

  /**
   * Get query partitions for pagination
   */
  const getQueryPartitions = async (queryReq: any) => {
    try {
      const parsedSQL: any = fnParsedSQL(searchObj.data.query);

      if (
        searchObj.meta.sqlMode &&
        parsedSQL != undefined &&
        (parsedSQL.limit != null || parsedSQL.offset != null)
      ) {
        return null;
      } else {
        const partitionQueryReq: any = {
          query: {
            sql: queryReq.query.sql,
            start_time: queryReq.query.start_time,
            end_time: queryReq.query.end_time,
            from: queryReq.query.from,
            size: queryReq.query.size,
            quick_mode: false,
            query_type: "",
            track_total_hits: false,
          },
          aggs: {},
          encoding: "base64",
        };

        partitionQueryReq.org_identifier = queryReq.org_identifier;

        if (searchObj.meta.regions?.length) {
          partitionQueryReq.regions = searchObj.meta.regions;
        }

        return await logsApi.partition(partitionQueryReq);
      }
    } catch (error: any) {
      console.error("Error in getQueryPartitions:", error);
      return null;
    }
  };

  /**
   * Generate URL query parameters for sharing/bookmarking
   */
  const generateURLQuery = (isShareLink: boolean = false, dashboardPanelData: any = null) => {
    try {
      const params: URLQueryParams = {
        stream: searchObj.data.stream.selectedStream,
        query: btoa(encodeURIComponent(searchObj.data.query)),
        type: searchObj.data.stream.streamType,
        period: searchObj.data.datetime,
        from: searchObj.meta.resultGrid.currentRowIndex,
        size: searchObj.meta.resultGrid.rowsPerPage,
        queryType: searchObj.meta.quickMode ? "quick" : "standard",
      };

      if (!isShareLink) {
        params.org_identifier = store.state.selectedOrganization?.identifier;
        if (searchObj.data.stream.selectedFields?.length) {
          params.show = searchObj.data.stream.selectedFields;
        }
        if (searchObj.data.stream.filterField) {
          params.filter = btoa(encodeURIComponent(searchObj.data.stream.filterField));
        }
        if (searchObj.meta.refreshInterval > 0) {
          params.refresh = searchObj.meta.refreshInterval;
        }
        if (searchObj.meta.sqlMode) {
          params.sql_mode = searchObj.meta.sqlMode;
        }
        if (searchObj.meta.quickMode) {
          params.quick_mode = searchObj.meta.quickMode;
        }
      }

      return generateURLQueryUtil(params);
    } catch (error: any) {
      console.error("Error generating URL query:", error);
      return "";
    }
  };

  /**
   * Execute search query
   */
  const getQueryData = async (isPagination = false) => {
    try {
      if (searchObj.data.stream.selectedStream.length === 0) {
        searchObj.data.queryResults.hits = [];
        searchObj.data.queryResults.total = 0;
        searchObj.data.histogram.loading = false;
        searchObj.data.histogram.errorCode = 0;
        searchObj.data.histogram.errorMsg = "";
        return;
      }

      searchObj.loading = true;
      searchObj.data.errorMsg = "";

      const queryReq: any = buildSearch();

      if (searchObj.meta.sqlMode && queryReq.query.sql.trim() === "") {
        searchObj.data.errorMsg = "SQL mode requires a non-empty query.";
        return;
      }

      // Handle different communication methods
      if (searchObj.communicationMethod === "websocket") {
        await handleWebSocketSearch(queryReq, isPagination);
      } else {
        await handleHttpSearch(queryReq, isPagination);
      }
    } catch (error: any) {
      console.error("Error in getQueryData:", error);
      searchObj.data.errorMsg = error.message || "An unexpected error occurred while fetching data.";
      searchObj.loading = false;
    }
  };

  /**
   * Handle WebSocket-based search
   */
  const handleWebSocketSearch = async (queryReq: SearchRequestPayload, isPagination: boolean) => {
    try {
      const payload = buildWebSocketPayloadUtil(queryReq, isPagination, "search");
      const requestId = initializeSearchConnection(payload);
      
      if (requestId) {
        addTraceId(requestId);
      }
    } catch (error: any) {
      console.error("WebSocket search error:", error);
      throw error;
    }
  };

  /**
   * Handle HTTP-based search
   */
  const handleHttpSearch = async (queryReq: SearchRequestPayload, isPagination: boolean) => {
    try {
      const response = await logsApi.search(queryReq);
      await updateResult(queryReq, response.data, isPagination, false);
    } catch (error: any) {
      console.error("HTTP search error:", error);
      searchObj.data.errorMsg = error.response?.data?.error || error.message;
      throw error;
    }
  };

  /**
   * Initialize WebSocket search connection
   */
  const initializeSearchConnection = (payload: any): string | null => {
    try {
      const requestId = fetchQueryDataWithWebSocket(payload, {
        open: handleSearchOpen,
        message: handleSearchMessage,
        close: handleSearchClose,
        error: handleSearchError,
        reset: handleSearchReset,
      });

      return requestId || null;
    } catch (error: any) {
      console.error("Failed to initialize search connection:", error);
      return null;
    }
  };

  /**
   * Handle WebSocket search open event
   */
  const handleSearchOpen = (data: any, response: any) => {
    // WebSocket connection opened
  };

  /**
   * Handle WebSocket search message event
   */
  const handleSearchMessage = (data: any, response: WebSocketSearchResponse) => {
    try {
      if (response.content?.results) {
        handleStreamingHits(data, response, data.isPagination, false);
      }
      if (response.content?.metadata) {
        handleStreamingMetadata(data, response, data.isPagination, false);
      }
    } catch (error: any) {
      console.error("Error handling search message:", error);
    }
  };

  /**
   * Handle WebSocket search close event
   */
  const handleSearchClose = (data: any, response: any) => {
    try {
      if (data.traceId) {
        closeSocketBasedOnRequestId(data.traceId);
      }
      searchObj.loading = false;
    } catch (error: any) {
      console.error("Error handling search close:", error);
    }
  };

  /**
   * Handle WebSocket search error event
   */
  const handleSearchError = (data: any, error: any) => {
    try {
      console.error("WebSocket search error:", error);
      searchObj.data.errorMsg = error.content?.message || "Search operation failed";
      searchObj.loading = false;
    } catch (err: any) {
      console.error("Error handling search error:", err);
    }
  };

  /**
   * Handle WebSocket search reset event
   */
  const handleSearchReset = async (data: any, traceId?: string) => {
    try {
      // Retry the search after reset
      if (data.queryReq) {
        const payload = buildWebSocketPayloadUtil(data.queryReq, data.isPagination, "search");
        const requestId = initializeSearchConnection(payload);
        
        if (requestId && traceId) {
          // Replace the old trace ID with new one
          removeTraceId(traceId);
          addTraceId(requestId);
        }
      }
    } catch (error: any) {
      console.error("Error handling search reset:", error);
    }
  };

  /**
   * Handle streaming search results
   */
  const handleStreamingHits = (payload: WebSocketSearchPayload, response: WebSocketSearchResponse, isPagination: boolean, appendResult: boolean = false) => {
    try {
      if (response.content?.results?.hits) {
        // Process and add hits to results
        // Implementation depends on specific data structure requirements
      }
    } catch (error: any) {
      console.error("Error handling streaming hits:", error);
    }
  };

  /**
   * Handle streaming search metadata
   */
  const handleStreamingMetadata = (payload: WebSocketSearchPayload, response: WebSocketSearchResponse, isPagination: boolean, appendResult: boolean = false) => {
    try {
      if (response.content?.metadata) {
        // Process metadata
        // Implementation depends on specific metadata requirements
      }
    } catch (error: any) {
      console.error("Error handling streaming metadata:", error);
    }
  };

  /**
   * Update search results
   */
  const updateResult = async (queryReq: SearchRequestPayload, response: any, isPagination: boolean, appendResult: boolean = false) => {
    try {
      // Update search results based on response
      // Implementation depends on specific result structure
      searchObj.loading = false;
    } catch (error: any) {
      console.error("Error updating search results:", error);
      searchObj.loading = false;
    }
  };

  /**
   * Add trace ID to search requests
   */
  const addTraceId = (traceId: string) => {
    if (!searchObj.data.searchRequestTraceIds.includes(traceId)) {
      searchObj.data.searchRequestTraceIds.push(traceId);
    }
  };

  /**
   * Remove trace ID from search requests
   */
  const removeTraceId = (traceId: string) => {
    const index = searchObj.data.searchRequestTraceIds.indexOf(traceId);
    if (index > -1) {
      searchObj.data.searchRequestTraceIds.splice(index, 1);
    }
  };

  /**
   * Cancel ongoing search queries
   */
  const cancelQuery = async (): Promise<boolean> => {
    try {
      if (!searchObj.data.searchRequestTraceIds.length) {
        searchObj.data.isOperationCancelled = false;
        return false;
      }

      searchObj.data.isOperationCancelled = true;

      searchObj.data.searchRequestTraceIds.forEach((traceId) => {
        cancelSearchQueryBasedOnRequestId({
          trace_id: traceId,
          org_id: store?.state?.selectedOrganization?.identifier,
        });
      });

      return true;
    } catch (error: any) {
      console.error("Failed to cancel search queries:", error);
      showErrorNotification("Failed to cancel search operations");
      return false;
    }
  };

  /**
   * Execute search around a specific record
   */
  const searchAroundData = (obj: any) => {
    try {
      const query = searchObj.data.query;
      let parseQuery = [];
      
      if (searchObj.meta.sqlMode) {
        const parsedSQL: any = fnParsedSQL(query);
        if (parsedSQL && parsedSQL.whereClause) {
          parseQuery = [parsedSQL.whereClause];
        } else {
          parseQuery = [query];
        }
      } else {
        parseQuery = [query];
      }

      // Build search around request
      const streamsData: any = searchObj.data.stream.selectedStream.filter((stream: any) => {
        return stream.streamType === searchObj.data.stream.streamType;
      });

      // Implementation continues based on specific search around requirements
      
    } catch (error: any) {
      console.error("Error in search around:", error);
    }
  };

  return {
    // Core search functions
    buildSearch,
    getQueryData,
    searchAroundData,
    cancelQuery,
    
    // Query utilities
    isLimitQuery,
    isDistinctQuery,
    isWithQuery,
    getQueryPartitions,
    
    // URL and sharing
    generateURLQuery,
    
    // WebSocket handlers
    initializeSearchConnection,
    handleSearchOpen,
    handleSearchMessage,
    handleSearchClose,
    handleSearchError,
    handleSearchReset,
    
    // Streaming handlers
    handleStreamingHits,
    handleStreamingMetadata,
    
    // Result management
    updateResult,
    addTraceId,
    removeTraceId,
    
    // State
    searchPartitionMap,
  };
};

export default useLogsSearch;
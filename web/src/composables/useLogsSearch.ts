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
import search from "@/services/search";
import useSearchWebSocket from "@/composables/useSearchWebSocket";
import useQuery from "@/composables/useQuery";
import { useLogsState } from "@/composables/useLogsState";
import { useLogsData } from "@/composables/useLogsData";
import {
  createSQLParserFunctions,
  extractValueQuery,
} from "@/utils/logs/parsers";
import {
  buildWebSocketPayload as buildWebSocketPayloadUtil,
  chunkedAppend,
} from "@/utils/logs/transformers";
import {
  MAX_SEARCH_RETRIES,
  SEARCH_RECONNECT_DELAY,
} from "@/utils/logs/constants";
import useNotifications from "@/composables/useNotifications";
import { generateTraceContext } from "@/utils/zincutils";

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
  const { showErrorNotification } = useNotifications();
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
  
  const {
    processPostPaginationData,
    updateFieldValues,
    extractFields,
    updateGridColumns,
    handleFunctionError,
    handleAggregation,
    refreshPagination,
  } = useLogsData();
  

  // Search partition mapping
  const searchPartitionMap = reactive<{ [key: string]: number }>({});

  /**
   * Reset query data
   */
  const resetQueryData = () => {
    searchObj.data.sortedQueryResults = [];
    searchObj.data.resultGrid.currentPage = 1;
    searchObj.runQuery = false;
    searchObj.data.errorMsg = "";
    searchObj.data.errorDetail = "";
    searchObj.data.countErrorMsg = "";
  };

  /**
   * Get paginated data (matches original implementation)
   */
  const getPaginatedData = async (queryReq: any, appendResult: boolean = false, isInitialRequest: boolean = true) => {
    return new Promise((resolve, reject) => {
      // Check if operation is cancelled
      if (searchObj.data.isOperationCancelled) {
        searchObj.loading = false;
        searchObj.data.isOperationCancelled = false;
        showErrorNotification("Search operation is cancelled.");
        return;
      }

      const parsedSQL: any = createSQLParserFunctions(null).parseSQL(searchObj.data.query);

      if (isInitialRequest) {
        searchObj.meta.resultGrid.showPagination = true;
      }

      // Handle SQL mode aggregation and limit queries (matching original)
      if (searchObj.meta.sqlMode == true && parsedSQL != undefined) {
        // If query has aggregation or groupby then we need to set size to -1 to get all records
        // Here BE return all the records if we set the size to -1 as we don't support pagination for aggregation and groupby
        if (parsedSQL.groupby != null) {
          queryReq.query.size = -1;
        }
        
        // If the query has limit then we need to set the size to the limit as we don't support pagination for limit
        if (parsedSQL.limit != null) {
          queryReq.query.size = parsedSQL.limit.value[0].value;
          searchObj.meta.resultGrid.showPagination = false;
          
          if (parsedSQL.limit.separator == "offset") {
            queryReq.query.from = parsedSQL.limit.value[1].value || 0;
          }
          delete queryReq.query.track_total_hits;
        }
        
        // Remove track_total_hits for specific query types
        if (parsedSQL.distinct != null || parsedSQL.with != null || !searchObj.data.queryResults.is_histogram_eligible) {
          delete queryReq.query.track_total_hits;
        }
      }

      // Set histogram interval if available
      if (searchObj.data.queryResults.histogram_interval) {
        queryReq.query.histogram_interval = searchObj.data.queryResults.histogram_interval;
      }

      // Generate trace context (matching original)
      const { traceparent, traceId } = generateTraceContext();
      addTraceId(traceId);
      
      // Determine which search function to call
      const searchCall = searchObj.meta.jobId 
        ? search.get_scheduled_search_result
        : search.search;

      // Ensure organizationIdentifier is set
      if (!searchObj.organizationIdentifier && store.state?.selectedOrganization?.identifier) {
        searchObj.organizationIdentifier = store.state.selectedOrganization.identifier;
      }
      
      // Ensure streamType is set (default to "logs")  
      if (!searchObj.data.stream.streamType) {
        searchObj.data.stream.streamType = "logs";
      }
      
      if (searchCall) {
        console.log("🔧 getPaginatedData calling with:", {
          org_identifier: searchObj.organizationIdentifier,
          page_type: searchObj.data.stream.streamType,
          queryReq: queryReq
        });
        
        searchCall(
          {
            org_identifier: searchObj.organizationIdentifier,
            query: queryReq,
            jobId: searchObj.meta.jobId ? searchObj.meta.jobId : "",
            page_type: searchObj.data.stream.streamType,
            traceparent,
          },
          "ui",
        )
        .then(async (res: any) => {
          // Process function errors if any
          if (res.data.hasOwnProperty("function_error") && res.data.function_error != "") {
            searchObj.data.functionError = res.data.function_error;
          }

          // Handle successful response
          await updateResult(queryReq, res.data, false, appendResult);
          resolve(res);
        })
        .catch((err: any) => {
          console.error("Error in getPaginatedData:", err);
          searchObj.loading = false;
          searchObj.data.errorMsg = err.response?.data?.error || err.message;
          reject(err);
        });
      } else {
        reject(new Error("Search function not available"));
      }
    });
  };

  /**
   * Generate histogram data
   */
  const generateHistogram = async (queryReq: any, parsedSQL: any) => {
    try {
      searchObj.meta.refreshHistogram = false;
      if (searchObj.data.queryResults.hits.length > 0) {
        if (searchObj.data.stream.selectedStream.length > 1 && searchObj.meta.sqlMode == true) {
          // Multi-stream SQL mode - no histogram
          searchObj.data.histogram = {
            xData: [],
            yData: [],
            chartParams: {
              title: "", // Should use getHistogramTitle()
              unparsed_x_data: [],
              timezone: "",
            },
            errorCode: 0,
            errorMsg: "Histogram is not available for multi-stream SQL mode search.",
            errorDetail: "",
          };
          searchObj.meta.histogramDirtyFlag = false;
        } else {
          // Single stream or multi-stream non-SQL mode
          searchObj.data.histogram.errorMsg = "";
          searchObj.data.histogram.errorCode = 0;
          searchObj.data.histogram.errorDetail = "";
          searchObj.loadingHistogram = true;

          // Generate histogram skeleton and process partitions
          // This would need full implementation based on original
          console.log("Generating histogram for partitions...");
          
          searchObj.loadingHistogram = false;
        }
      }
    } catch (error: any) {
      console.error("Error generating histogram:", error);
      searchObj.loadingHistogram = false;
    }
  };

  /**
   * Build search query request
   */
  const buildSearch = () => {
    // Ensure organizationIdentifier is set
    if (!searchObj.organizationIdentifier && store.state?.selectedOrganization?.identifier) {
      searchObj.organizationIdentifier = store.state.selectedOrganization.identifier;
    }
    
    // Ensure streamType is set (default to "logs")  
    if (!searchObj.data.stream.streamType) {
      searchObj.data.stream.streamType = "logs";
    }
    
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
        streamName: searchObj.data.stream.selectedStream[0] || "",
        timestamps: {
          startTime: timestamps.start_time,
          endTime: timestamps.end_time
        },
        from: 0,
        size: searchObj.meta.resultGrid.rowsPerPage,
        sqlMode: searchObj.meta.sqlMode,
        currentPage: searchObj.data.resultGrid.currentPage,
        selectedStream: searchObj.data.stream.selectedStream[0] || "",
        timeInterval: searchObj.meta.resultGrid.chartInterval || "1 minute",
        parsedQuery: {
          queryFunctions: "",
          whereClause: "",
          limit: 0,
          query: query,
          offset: 0
        }
      };

      console.log("🔧 Building query payload with data:", queryPayloadData);
      const req = buildQueryPayload(queryPayloadData);
      console.log("🔧 buildQueryPayload returned:", req);
      
      if (!req) {
        throw new Error("Failed to build search query payload");
      }
      
      // The search API expects a clean query object without aggs and org_identifier
      // Create a clean structure matching the original
      const cleanQueryReq = {
        query: {
          ...req.query
        }
      };
      
      // Override SQL if needed
      if (searchObj.meta.sqlMode && query && query.trim() !== "") {
        cleanQueryReq.query.sql = query;
        console.log("🔧 Set SQL query (SQL mode):", cleanQueryReq.query.sql);
      } else if (query && query.trim() !== "" && !query.includes('[FIELD_LIST]')) {
        cleanQueryReq.query.sql = query;
        console.log("🔧 Set SQL query (non-SQL mode):", cleanQueryReq.query.sql);
      }
      
      cleanQueryReq.query.quick_mode = searchObj.meta.quickMode;
      cleanQueryReq.query.track_total_hits = searchObj.data.countEnabled;
      
      // Handle SQL mode specific settings (matching original)
      if (searchObj.meta.sqlMode) {
        cleanQueryReq.query.sql_mode = "full";  // This is the critical missing field!
      }
      
      if (searchObj.meta.regions?.length) {
        cleanQueryReq.regions = searchObj.meta.regions;
      }
      
      console.log("🔧 Final clean request structure:", cleanQueryReq);
      console.log("🔧 Final clean query structure:", cleanQueryReq.query);
      
      // Return the clean request object without aggs and org_identifier
      return cleanQueryReq;
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
   * Get query partitions for pagination (matches original implementation)
   */
  const getQueryPartitions = async (queryReq: any) => {
    try {
      // Reset hits and histogram
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

      const parsedSQL: any = createSQLParserFunctions(null).parseSQL(searchObj.data.query);

      // In Limit we don't need to get partitions, as we directly hit search request with query limit
      if (
        !searchObj.meta.sqlMode ||
        (searchObj.meta.sqlMode && parsedSQL && parsedSQL.limit == null)
      ) {
        const partitionQueryReq: any = {
          sql: queryReq.query.sql,
          start_time: queryReq.query.start_time,
          end_time: queryReq.query.end_time,
        };

        // If sql_base64_enabled is true, then we will encode the query
        if (store.state.zoConfig.sql_base64_enabled) {
          partitionQueryReq["encoding"] = "base64";
        }

        // Add enterprise features if enabled
        if (searchObj.meta.regions?.length) {
          partitionQueryReq["regions"] = searchObj.meta.regions;
        }

        // Generate trace context (matching original)
        const { traceparent, traceId } = generateTraceContext();
        addTraceId(traceId);

        partitionQueryReq["streaming_output"] = true;

        searchObj.data.queryResults.histogram_interval = null;
        searchObj.data.queryResults.visualization_histogram_interval = null;

        // Ensure organizationIdentifier is set
        if (!searchObj.organizationIdentifier && store.state?.selectedOrganization?.identifier) {
          searchObj.organizationIdentifier = store.state.selectedOrganization.identifier;
        }
        
        // Ensure streamType is set (default to "logs")
        if (!searchObj.data.stream.streamType) {
          searchObj.data.stream.streamType = "logs";
        }
        
        console.log("🔧 Debug values for partition API:");
        console.log("- organizationIdentifier:", searchObj.organizationIdentifier);
        console.log("- streamType:", searchObj.data.stream.streamType);
        console.log("- store selectedOrganization:", store.state.selectedOrganization);
        console.log("- partitionQueryReq:", partitionQueryReq);
        
        console.log("🔧 Calling partition API with:", {
          org_identifier: searchObj.organizationIdentifier,
          query: partitionQueryReq,
          page_type: searchObj.data.stream.streamType,
        });

        const partitionResponse = await search.partition({
          org_identifier: searchObj.organizationIdentifier,
          query: partitionQueryReq,
          page_type: searchObj.data.stream.streamType,
          traceparent,
          enable_align_histogram: true,
        });

        console.log("✅ Partition API response:", partitionResponse);

        // Process partition response to set up pagination (matching original implementation)
        if (partitionResponse.data) {
          searchObj.data.queryResults.partitionDetail = {
            partitions: [],
            partitionTotal: [],
            paginations: [],
          };
          
          // Set histogram eligibility and intervals
          searchObj.data.queryResults.is_histogram_eligible = partitionResponse.data?.is_histogram_eligible;
          searchObj.data.queryResults.histogram_interval = partitionResponse.data.histogram_interval;
          
          if (!searchObj.data.queryResults.visualization_histogram_interval && partitionResponse.data?.histogram_interval) {
            searchObj.data.queryResults.visualization_histogram_interval = partitionResponse.data?.histogram_interval;
          }

          // Process partitions based on query type (single stream vs multi-stream)
          if (typeof partitionQueryReq.sql != "string") {
            // Multi-stream case
            const partItem = partitionResponse.data;
            searchObj.data.queryResults.total += partItem.records;
            
            if (partItem.partitions && partItem.partitions.length > 0) {
              const partitions = partItem.partitions;
              searchObj.data.queryResults.partitionDetail.partitions = partitions;
              
              for (const [index, item] of partitions.entries()) {
                const pageObject = [
                  {
                    startTime: item[0],
                    endTime: item[1],
                    from: 0,
                    size: searchObj.meta.resultGrid.rowsPerPage,
                    streaming_output: partitionResponse.data?.streaming_aggs || false,
                    streaming_id: partitionResponse.data?.streaming_id || null,
                  },
                ];
                searchObj.data.queryResults.partitionDetail.paginations.push(pageObject);
                searchObj.data.queryResults.partitionDetail.partitionTotal.push(-1);
              }
            }
          } else {
            // Single stream case
            searchObj.data.queryResults.total = 0;
            const partitions = partitionResponse.data.partitions;
            
            if (partitions && partitions.length > 0) {
              searchObj.data.queryResults.partitionDetail.partitions = partitions;
              
              for (const [index, item] of partitions.entries()) {
                const pageObject = [
                  {
                    startTime: item[0],
                    endTime: item[1],
                    from: 0,
                    size: searchObj.meta.resultGrid.rowsPerPage,
                    streaming_output: partitionResponse.data?.streaming_aggs || false,
                    streaming_id: partitionResponse.data?.streaming_id || null,
                  },
                ];
                searchObj.data.queryResults.partitionDetail.paginations.push(pageObject);
                searchObj.data.queryResults.partitionDetail.partitionTotal.push(-1);
              }
            }
          }
        }

        return partitionResponse;
      }
      
      return null;
    } catch (error: any) {
      console.error("Error in getQueryPartitions:", error);
      searchObj.data.errorMsg = error.response?.data?.error || error.message;
      throw error;
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

      const query = new URLSearchParams();
      Object.keys(params).forEach(key => {
        if (params[key] != null) {
          if (Array.isArray(params[key])) {
            query.append(key, params[key].join(','));
          } else {
            query.append(key, params[key].toString());
          }
        }
      });
      return query.toString();
    } catch (error: any) {
      console.error("Error generating URL query:", error);
      return "";
    }
  };

  /**
   * Execute search query
   */
  const getQueryData = async (isPagination = false) => {
    console.log("🔍 getQueryData called with isPagination:", isPagination);
    console.log("📊 Current state:", {
      selectedStreams: searchObj.data.stream.selectedStream,
      streamsLength: searchObj.data.stream.selectedStream.length,
      sqlMode: searchObj.meta.sqlMode,
      query: searchObj.data.query,
      communicationMethod: searchObj.communicationMethod,
      streamLists: searchObj.data.stream.streamLists?.length
    });
    
    try {
      // Reset cancel query on new search request initiation
      searchObj.data.isOperationCancelled = false;
      
      // Check if streams are available and selected (matching original logic)
      if (
        !searchObj.data.stream.streamLists?.length ||
        searchObj.data.stream.selectedStream.length == 0
      ) {
        console.log("❌ No streams available or selected - returning early");
        searchObj.loading = false;
        return;
      }

      // Set communication method
      searchObj.meta.jobId = "";
      
      console.log("✅ Streams are available and selected, continuing...");
      searchObj.meta.showDetailTab = false;
      searchObj.meta.searchApplied = true;
      searchObj.data.functionError = "";

      console.log("🔄 Communication method:", searchObj.communicationMethod);

      // Use the appropriate method to fetch data (matching original implementation)
      if (searchObj.communicationMethod === "ws" || searchObj.communicationMethod === "streaming") {
        console.log("📡 Using WebSocket/streaming method");
        await getDataThroughStream(isPagination);
        return;
      }

      // HTTP method flow
      console.log("🌐 Using HTTP method");
      console.log("🔧 Building search request...");
      const queryReq: any = buildSearch();
      console.log("🔧 Built queryReq:", queryReq);

      if (!queryReq) {
        throw new Error("Failed to build search query");
      }

      if (searchObj.meta.sqlMode && queryReq.query.sql.trim() === "") {
        console.log("❌ SQL mode with empty query - returning early");
        searchObj.data.errorMsg = "SQL mode requires a non-empty query.";
        searchObj.loading = false;
        return;
      }

      console.log("✅ Query validation passed, proceeding with search...");

      // Update URL query parameters (if not pagination)
      if (!isPagination) {
        console.log("🔗 Updating URL query parameters...");
        // URL update would be handled by useLogsURL composable
      }

      // Reset query data and get partition detail for given query (if not pagination)
      if (!isPagination) {
        resetQueryData();
        console.log("📦 Getting query partitions...");
        await getQueryPartitions(queryReq);
        console.log("✅ Query partitions complete");
      }

      if (queryReq != null) {
        // In case of live refresh, reset from to 0
        if (
          searchObj.meta.refreshInterval > 0 &&
          router.currentRoute.value.name == "logs"
        ) {
          queryReq.query.from = 0;
          searchObj.meta.refreshHistogram = true;
        }

        // Update query with function or action (if needed)
        // addTransformToQuery(queryReq);

        // In case of relative time, set start_time and end_time to query
        if (searchObj.data.datetime.type === "relative") {
          if (!isPagination) {
            // Store initial query payload for pagination requests
            // initialQueryPayload.value = cloneDeep(queryReq);
          }
        }

        // Reset errorCode
        searchObj.data.errorCode = 0;

        // Copy query request for histogram query
        searchObj.data.histogramQuery = JSON.parse(JSON.stringify(queryReq));
        searchObj.data.histogramQuery.query.sql = queryReq.query.sql;
        
        delete searchObj.data.histogramQuery.query.quick_mode;
        delete searchObj.data.histogramQuery.query.from;
        delete searchObj.data.histogramQuery.aggs;
        
        searchObj.data.customDownloadQueryObj = JSON.parse(JSON.stringify(queryReq));

        // Get the current page detail and set it into query request
        if (searchObj.data.queryResults.partitionDetail?.paginations) {
          const currentPageDetail = searchObj.data.queryResults.partitionDetail.paginations[
            searchObj.data.resultGrid.currentPage - 1
          ];
          if (currentPageDetail && currentPageDetail[0]) {
            queryReq.query.start_time = currentPageDetail[0].startTime;
            queryReq.query.end_time = currentPageDetail[0].endTime;
            queryReq.query.from = currentPageDetail[0].from;
            queryReq.query.size = currentPageDetail[0].size;
            queryReq.query.streaming_output = currentPageDetail[0].streaming_output;
            queryReq.query.streaming_id = currentPageDetail[0].streaming_id;

            // For custom download
            searchObj.data.customDownloadQueryObj.query.streaming_output = queryReq.query.streaming_output;
            searchObj.data.customDownloadQueryObj.query.streaming_id = queryReq.query.streaming_id;
          }
        }

        // Setting subpage for pagination
        searchObj.data.queryResults.subpage = 1;

        // Get paginated data
        console.log("📄 Getting paginated data...");
        await getPaginatedData(queryReq);
        console.log("✅ Paginated data complete");

        // Handle histogram generation if needed
        if (!isPagination && searchObj.meta.refreshInterval == 0 && searchObj.data.queryResults.hits?.length > 0) {
          searchObj.meta.resetPlotChart = true;
        }

        // Check if histogram should be generated
        const parsedSQL: any = createSQLParserFunctions(null).parseSQL(searchObj.data.query);
        
        const shouldGenerateHistogram = (
          (searchObj.data.queryResults.aggs == undefined &&
            searchObj.meta.refreshHistogram == true &&
            searchObj.loadingHistogram == false &&
            searchObj.meta.showHistogram == true) ||
          (searchObj.loadingHistogram == false &&
            searchObj.meta.showHistogram == true &&
            searchObj.meta.sqlMode == false &&
            searchObj.meta.refreshHistogram == true)
        );

        if (shouldGenerateHistogram) {
          console.log("📊 Generating histogram...");
          await generateHistogram(queryReq, parsedSQL);
          console.log("✅ Histogram generation complete");
        }
      }

      searchObj.loading = false;
    } catch (error: any) {
      console.error("Error in getQueryData:", error);
      searchObj.data.errorMsg = error.message || "An unexpected error occurred while fetching data.";
      searchObj.loading = false;
    }
  };

  /**
   * Handle WebSocket/streaming data fetching (matching original implementation)
   */
  const getDataThroughStream = async (isPagination: boolean = false) => {
    try {
      console.log("📡 getDataThroughStream called with isPagination:", isPagination);
      const queryReq: any = buildSearch();
      const payload = buildWebSocketPayloadUtil(queryReq, isPagination, "search");
      const requestId = initializeSearchConnection(payload);
      
      if (requestId) {
        addTraceId(requestId);
      }
      
      console.log("✅ WebSocket search initiated with requestId:", requestId);
    } catch (error: any) {
      console.error("WebSocket search error:", error);
      searchObj.loading = false;
      throw error;
    }
  };

  /**
   * Handle WebSocket-based search (legacy function for backward compatibility)
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
  const handleHttpSearch = async (queryReq: any, isPagination: boolean) => {
    try {
      // Ensure organizationIdentifier is set
      if (!searchObj.organizationIdentifier && store.state?.selectedOrganization?.identifier) {
        searchObj.organizationIdentifier = store.state.selectedOrganization.identifier;
      }
      
      // Ensure streamType is set (default to "logs")  
      if (!searchObj.data.stream.streamType) {
        searchObj.data.stream.streamType = "logs";
      }
      
      console.log("🌐 handleHttpSearch calling with:", {
        org_identifier: searchObj.organizationIdentifier,
        query: queryReq,
        page_type: searchObj.data.stream.streamType
      });
      
      const response = await search.search({
        org_identifier: searchObj.organizationIdentifier,
        query: queryReq,
        page_type: searchObj.data.stream.streamType,
        traceparent: null
      });
      
      // Handle function error
      if (response.data.hasOwnProperty("function_error") && response.data.function_error != "") {
        searchObj.data.functionError = response.data.function_error;
      }
      
      // Debug: Log the response structure
      console.log("🔍 Search API response structure:", {
        responseKeys: Object.keys(response),
        dataKeys: Object.keys(response.data || {}),
        data: response.data,
        hasContent: !!response.data?.content,
        hasResults: !!response.data?.content?.results,
        hasHits: !!response.data?.content?.results?.hits,
        hitsLength: response.data?.content?.results?.hits?.length || 0,
        directHits: response.data?.hits?.length || 0,
        sampleHit: response.data?.content?.results?.hits?.[0] || response.data?.hits?.[0],
      });
      
      // Handle aggregation
      handleAggregation(queryReq, response.data);
      
      // Update results
      await updateResult(queryReq, response.data, isPagination, false);
      
      // Set up pagination array if not a pagination request
      if (!isPagination) {
        searchObj.data.queryResults.pagination = [];
      }
      
      // Refresh pagination if it's a pagination request
      if (isPagination) {
        refreshPagination(true);
      }
      
      // Process post-pagination data (extract fields, update grid columns, etc.)
      processPostPaginationData();
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
      // Handle refresh interval case
      if (searchObj.meta.refreshInterval > 0 && router.currentRoute.value.name === "logs") {
        searchObj.data.queryResults.from = response.from;
        searchObj.data.queryResults.scan_size = response.scan_size;
        searchObj.data.queryResults.took = response.took;
        searchObj.data.queryResults.aggs = response.aggs;
        searchObj.data.queryResults.hits = response.hits;
      }
      
      if (searchObj.meta.refreshInterval === 0) {
        // In page count we set track_total_hits
        if (!queryReq.query.hasOwnProperty("track_total_hits")) {
          delete response.total;
        }

        // Handle append result case
        if (appendResult) {
          await chunkedAppend(searchObj.data.queryResults.hits, response.hits);
          searchObj.data.queryResults.total += response.total;
          searchObj.data.queryResults.took += response.took;
          searchObj.data.queryResults.scan_size += response.scan_size;
        } else {
          if (response.streaming_aggs) {
            searchObj.data.queryResults = {
              ...response,
              took: (searchObj.data?.queryResults?.took || 0) + response.took,
              scan_size: (searchObj.data?.queryResults?.scan_size || 0) + response.scan_size,
            };
          } else if (isPagination) {
            searchObj.data.queryResults.hits = response.hits;
            searchObj.data.queryResults.from = response.from;
            searchObj.data.queryResults.scan_size = response.scan_size;
            searchObj.data.queryResults.took = response.took;
            searchObj.data.queryResults.total = response.total;
          } else {
            // Replace results for initial request
            const resultsData = response.content?.results || response;
            console.log("📋 Assigning queryResults:", {
              hasContent: !!response.content,
              hasResults: !!response.content?.results,
              resultsData,
              hitsCount: resultsData?.hits?.length || 0,
            });
            searchObj.data.queryResults = resultsData;
          }
        }
      }

      // Store time_offset for pagecount context
      if (searchObj.data.queryResults && response.time_offset) {
        searchObj.data.queryResults.time_offset = response.time_offset;
      }

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
    getDataThroughStream,
    getPaginatedData,
    searchAroundData,
    cancelQuery,
    
    // Query utilities
    isLimitQuery,
    isDistinctQuery,
    isWithQuery,
    getQueryPartitions,
    resetQueryData,
    generateHistogram,
    
    // URL and sharing
    generateURLQuery,
    
    // WebSocket handlers
    initializeSearchConnection,
    handleWebSocketSearch,
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
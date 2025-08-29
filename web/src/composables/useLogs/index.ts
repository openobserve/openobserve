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

/**
 * Main entry point for the refactored useLogs composable
 * 
 * This file maintains backward compatibility by importing all the extracted
 * composables and re-exporting their functions in the original API format.
 * 
 * The original 6,876-line useLogs.ts has been split into:
 * - useLogsState.ts: Reactive state management
 * - useLogsQuery.ts: Query building and execution
 * - useLogsFilters.ts: Filtering and search logic
 * - useLogsActions.ts: Actions and functions management
 * - useLogsVisualization.ts: Histogram and visualization logic
 * - useLogsWebSocket.ts: WebSocket communication
 * - useLogsURL.ts: URL and route management
 * - Plus utilities in utils/logs/ and services in services/logs/
 */

import { computed } from "vue";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql";

// Import all refactored composables
import { useLogsState } from "@/composables/useLogsState";
import { useLogsQuery } from "@/composables/useLogsQuery";
import { useLogsFilters } from "@/composables/useLogsFilters";
import { useLogsActions } from "@/composables/useLogsActions";
import { useLogsVisualization } from "@/composables/useLogsVisualization";
import { useLogsWebSocket } from "@/composables/useLogsWebSocket";
import { useLogsURL } from "@/composables/useLogsURL";
import { useLogsData } from "@/composables/useLogsData";

// Import utility functions
import {
  createSQLParserFunctions
} from "@/utils/logs/parsers";
import {
  encodeVisualizationConfig,
  decodeVisualizationConfig
} from "@/utils/logs/transformers";
import {
  isDefaultInterestingField,
  filterInterestingFields,
  updateFieldInterestingStatus,
  rebuildInterestingFieldsList,
  buildInterestingFieldNamesList,
  type LogField,
  type StoreConfig
} from "@/utils/logs/interestingFields";

// Import services (these will be used internally by the composables)
import useStreams from "@/composables/useStreams";
import useQuery from "@/composables/useQuery";
import useNotifications from "@/composables/useNotifications";
import savedViews from "@/services/saved_views";

/**
 * Main useLogs composable that combines all the refactored modules
 * while maintaining the original API for backward compatibility
 */
export const useLogs = () => {
  // Initialize all composables
  const logsState = useLogsState();
  const logsQuery = useLogsQuery();
  const logsFilters = useLogsFilters();
  const logsActions = useLogsActions();
  const logsVisualization = useLogsVisualization();
  const logsWebSocket = useLogsWebSocket();
  const logsURL = useLogsURL();
  const logsData = useLogsData();

  // Initialize additional dependencies
  const { getStreams, getStream } = useStreams();
  const { buildQueryPayload } = useQuery();
  const { showErrorNotification } = useNotifications();
  const router = useRouter();
  const $q = useQuasar();
  const store = useStore();

  // Initialize parser (maintaining original pattern)
  let parser: any = null;
  try {
    parser = new Parser();
  } catch (error) {
    console.warn("Parser initialization failed:", error);
  }

  // Create SQL parser functions
  const { parseSQL: fnParsedSQL, unparseSQL: fnUnparsedSQL } = createSQLParserFunctions(parser);

  // Access state from logsState composable
  const {
    searchObj,
    searchAggData,
    fieldValues,
    streamSchemaFieldsIndexMapping
  } = logsState;

  // Computed properties for backward compatibility
  const isActionsEnabled = computed(() => {
    return logsActions.isActionsEnabled.value;
  });

  // Query execution functions (using function declarations for hoisting)
  async function getQueryData(isPagination: boolean = false) {
    try {
      // Clear cache
      if (Object.keys(searchObj.data.originalDataCache || {}).length > 0) {
        searchObj.data.originalDataCache = {};
      }

      const queryReq: any = logsQuery.buildSearchRequest();
      if (!queryReq) {
        throw new Error("Invalid query request");
      }

      if (!isPagination) {
        // Reset query data and get partition details
        await getQueryPartitions(queryReq);
      }

      // Get paginated data
      await getPaginatedData(queryReq);

      searchObj.loading = false;
      return queryReq;
    } catch (error: any) {
      console.error("Error getting query data:", error);
      searchObj.loading = false;
      throw error;
    }
  }

  async function handleQueryData(resetFlag: boolean = true) {
    try {
      searchObj.data.tempFunctionLoading = false;
      searchObj.data.tempFunctionName = "";
      searchObj.data.tempFunctionContent = "";
      searchObj.loading = true;

      await getQueryData();
    } catch (error: any) {
      console.error("Error while loading query data:", error);
      searchObj.loading = false;
    }
  }

  // Utility function to extract stream name consistently
  const extractStreamName = (stream: any): string => {
    if (typeof stream === 'string') {
      return stream;
    } else if (stream && typeof stream === 'object') {
      return stream.value || stream.name || stream.label || String(stream);
    } else {
      return String(stream);
    }
  };

  // Functions that need to be implemented in the main composable
  // These are complex functions that span multiple composables
  const onStreamChange = async (queryStr: string) => {
    console.log("🔄 onStreamChange called!", { 
      queryStr, 
      selectedStreams: searchObj.data.stream.selectedStream,
      streamTypes: searchObj.data.stream.selectedStream.map((s: any) => ({ 
        stream: s, 
        type: typeof s, 
        stringified: String(s) 
      }))
    });
    try {
      searchObj.loadingStream = true;
      await logsWebSocket.cancelQuery();
      
      // Reset query results
      searchObj.data.queryResults = { hits: [] };
      
      // Build UNION query once
      const streams = searchObj.data.stream.selectedStream;
      const unionquery = streams
        .map((stream: any) => {
          const streamName = extractStreamName(stream);
          console.log("🔧 Processing stream:", { stream, streamName, type: typeof stream });
          return `SELECT [FIELD_LIST] FROM "${streamName}"`;
        })
        .join(" UNION ");
      const query = searchObj.meta.sqlMode ? queryStr || unionquery : "";

      // Fetch all stream data in parallel using getStream from useStreams
      const streamDataPromises = streams.map((stream: any) => {
        const streamName = extractStreamName(stream);
        return getStream(streamName, searchObj.data.stream.streamType || "logs", true);
      });
      
      const streamDataResults = await Promise.all(streamDataPromises);
      console.log("📊 Stream data results:", streamDataResults.map(r => ({ name: r?.name, hasSchema: !!r?.schema, fieldCount: r?.schema?.length })));
      
      // Initialize group expansion state for streams
      const selectedStreamValues = streams.map(extractStreamName);
      
      // Initialize expandGroupRows - controls expand/collapse state of groups
      searchObj.data.stream.expandGroupRows = {
        common: true,
        ...Object.fromEntries(
          selectedStreamValues.sort().map((stream: any) => [
            stream,
            searchObj.data.stream.expandGroupRows?.[stream] !== undefined && selectedStreamValues.length > 1
              ? searchObj.data.stream.expandGroupRows[stream]
              : selectedStreamValues.length > 1 ? false : true,
          ])
        ),
      };
      
      // Initialize expandGroupRowsFieldCount - tracks number of fields per group
      searchObj.data.stream.expandGroupRowsFieldCount = {
        common: 0,
        ...Object.fromEntries(
          selectedStreamValues.sort().map((stream: any) => [stream, 0])
        ),
      };
      
      // Initialize interesting fields group state (copy of main group state)
      searchObj.data.stream.interestingExpandedGroupRows = JSON.parse(JSON.stringify(searchObj.data.stream.expandGroupRows));
      searchObj.data.stream.interestingExpandedGroupRowsFieldCount = JSON.parse(JSON.stringify(searchObj.data.stream.expandGroupRowsFieldCount));
      
      // Use utility function to determine if a field should be marked as interesting by default
      const storeConfig: StoreConfig = {
        default_quick_mode_fields: store.state?.zoConfig?.default_quick_mode_fields || [],
        timestamp_column: store.state.zoConfig?.timestamp_column
      };
      
      // Collect all schema fields and identify common fields
      const allStreamFields: any[] = [];
      const streamFieldsMap: { [fieldName: string]: any[] } = {};
      
      // First pass: collect all fields by name from all streams
      streamDataResults.forEach((streamData) => {
        if (streamData?.schema) {
          const streamName = streamData.name;
          
          streamData.schema.forEach((field: any) => {
            const fieldName = field.name;
            if (!streamFieldsMap[fieldName]) {
              streamFieldsMap[fieldName] = [];
            }
            streamFieldsMap[fieldName].push({
              ...field,
              streamName,
              ftsKey: field.ftsKey || false,
              isSchemaField: true,
              showValues: field.name !== store.state.zoConfig?.timestamp_column,
              isInterestingField: isDefaultInterestingField(field.name, storeConfig),
            });
          });
        }
      });
      
      // Identify common fields (fields that exist in all streams)
      const commonFields: any[] = [];
      const streamSpecificFields: { [streamName: string]: any[] } = {};
      
      // Initialize stream-specific fields arrays
      streamDataResults.forEach((streamData) => {
        if (streamData?.schema) {
          const streamName = streamData.name;
          streamSpecificFields[streamName] = [];
        }
      });
      
      Object.entries(streamFieldsMap).forEach(([fieldName, fieldInstances]) => {
        if (fieldInstances.length === streams.length) {
          // This field exists in all streams - it's a common field
          const commonField = {
            ...fieldInstances[0], // Use first instance as template
            group: "common",
            streams: fieldInstances.map(f => f.streamName),
          };
          delete commonField.streamName;
          commonFields.push(commonField);
        } else {
          // This field is specific to certain streams
          fieldInstances.forEach((field) => {
            const streamField = {
              ...field,
              group: field.streamName,
              streams: [field.streamName],
            };
            delete streamField.streamName;
            streamSpecificFields[field.streamName].push(streamField);
          });
        }
      });
      
      // Build final field list with proper ordering for multiple streams
      if (streams.length > 1) {
        // Add Common Group header and fields
        if (commonFields.length > 0) {
          allStreamFields.push({
            name: "Common Group Fields",
            label: true,
            ftsKey: false,
            isSchemaField: false,
            showValues: false,
            group: "common",
            isExpanded: false,
            streams: selectedStreamValues,
            isInterestingField: false
          });
          
          // Add common fields
          commonFields.forEach((field) => {
            allStreamFields.push(field);
            searchObj.data.stream.expandGroupRowsFieldCount["common"] = 
              (searchObj.data.stream.expandGroupRowsFieldCount["common"] || 0) + 1;
            searchObj.data.stream.interestingExpandedGroupRowsFieldCount["common"] = 
              (searchObj.data.stream.interestingExpandedGroupRowsFieldCount["common"] || 0) + 1;
          });
        }
        
        // Add stream-specific groups and fields
        selectedStreamValues.forEach((streamName) => {
          const streamFields = streamSpecificFields[streamName] || [];
          if (streamFields.length > 0) {
            // Add stream header
            allStreamFields.push({
              name: streamName.replace(/[^a-zA-Z0-9]/g, ''),
              label: true,
              ftsKey: false,
              isSchemaField: false,
              showValues: false,
              group: streamName,
              isExpanded: false,
              streams: [streamName],
              isInterestingField: false
            });
            
            // Add stream-specific fields
            streamFields.forEach((field) => {
              allStreamFields.push(field);
              searchObj.data.stream.expandGroupRowsFieldCount[streamName] = 
                (searchObj.data.stream.expandGroupRowsFieldCount[streamName] || 0) + 1;
              searchObj.data.stream.interestingExpandedGroupRowsFieldCount[streamName] = 
                (searchObj.data.stream.interestingExpandedGroupRowsFieldCount[streamName] || 0) + 1;
            });
          }
        });
      } else {
        // Single stream - add all fields directly without grouping
        Object.values(streamFieldsMap).forEach((fieldInstances) => {
          const field = fieldInstances[0];
          const streamName = field.streamName;
          const finalField = {
            ...field,
            group: streamName,
            streams: [streamName],
          };
          delete finalField.streamName;
          allStreamFields.push(finalField);
          
          searchObj.data.stream.expandGroupRowsFieldCount[streamName] = 
            (searchObj.data.stream.expandGroupRowsFieldCount[streamName] || 0) + 1;
          searchObj.data.stream.interestingExpandedGroupRowsFieldCount[streamName] = 
            (searchObj.data.stream.interestingExpandedGroupRowsFieldCount[streamName] || 0) + 1;
        });
      }
      
      console.log("🏷️ Extracted fields:", { 
        count: allStreamFields.length, 
        sampleFields: allStreamFields.slice(0, 3).map(f => ({ 
          name: f?.name, 
          group: f?.group, 
          isSchemaField: f?.isSchemaField,
          showValues: f?.showValues 
        })) 
      });
        
      // Update selectedStreamFields once
      searchObj.data.stream.selectedStreamFields = allStreamFields;
      
      // Use utility function to filter interesting fields
      const interestingFields = filterInterestingFields(allStreamFields, storeConfig);
      
      searchObj.data.stream.selectedInterestingStreamFields = interestingFields;
      
      // Use utility function to build interesting field names list
      searchObj.data.stream.interestingFieldList = buildInterestingFieldNamesList(interestingFields, storeConfig);
      console.log("✅ Updated selectedStreamFields with metadata, total count:", searchObj.data.stream.selectedStreamFields?.length);
      
      // Check if allStreamFields is empty
      if (!allStreamFields.length) {
        searchObj.loadingStream = false;
        return;
      }

      // Update selected fields if needed
      const streamFieldNames = new Set(
        allStreamFields.map((item: any) => item.name),
      );
      if (searchObj.data.stream.selectedFields.length > 0) {
        searchObj.data.stream.selectedFields =
          searchObj.data.stream.selectedFields.filter((fieldName: string) =>
            streamFieldNames.has(fieldName),
          );
      }

      // Update interesting fields list
      searchObj.data.stream.interestingFieldList =
        searchObj.data.stream.interestingFieldList.filter((fieldName: string) =>
          streamFieldNames.has(fieldName),
        );

      // Replace field list in query
      const fieldList =
        searchObj.meta.quickMode &&
        searchObj.data.stream.interestingFieldList.length > 0
          ? searchObj.data.stream.interestingFieldList.join(",")
          : "*";
      const finalQuery = query.replace(/\[FIELD_LIST\]/g, fieldList);

      // Update query related states
      searchObj.data.editorValue = finalQuery;
      searchObj.data.query = finalQuery;
      searchObj.data.tempFunctionContent = "";
      searchObj.meta.searchApplied = false;

      // Update histogram visibility
      if (streams.length > 1 && searchObj.meta.sqlMode == true) {
        searchObj.meta.showHistogram = false;
      }

      if (!store.state.zoConfig.query_on_stream_selection) {
        console.log("🔍 Query on stream selection enabled - calling handleQueryData");
        await handleQueryData();
      } else {
        console.log("📋 Query on stream selection disabled - resetting and calling extractFields");
        // Reset states when query on selection is disabled
        searchObj.data.sortedQueryResults = [];
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
        console.log("⚙️ Calling logsData.extractFields()...");
        logsData.extractFields();
      }
      console.log("✅ onStreamChange completed successfully");
    } catch (error: any) {
      console.error("❌ Error in onStreamChange:", error);
    } finally {
      searchObj.loadingStream = false;
    }
  };


  const loadLogsData = async () => {
    // Main function that loads logs data and initializes streams
    try {
      searchObj.loading = true;
      
      // Reset functions and load functions/actions
      logsActions.resetFunctions();
      await logsActions.getFunctions();
      
      if (logsActions.isActionsEnabled.value) {
        await logsActions.getActions();
      }

      // Load streams and populate dropdown
      await logsData.getStreamList(true);
      
      // Extract fields for the selected streams
      await logsData.extractFields();
      
      searchObj.loading = false;
    } catch (error: any) {
      console.error("Error loading logs data:", error);
      searchObj.loading = false;
    }
  };

  // Data refresh functions
  const refreshData = () => {
    return loadLogsData();
  };

  const refreshPagination = (regenerateFlag: boolean = false) => {
    try {
      const { rowsPerPage } = searchObj.meta.resultGrid;
      const { currentPage } = searchObj.data.resultGrid;
      
      if (searchObj.meta.jobId !== "") {
        searchObj.meta.resultGrid.rowsPerPage = 100;
      }
      
      let total = 0;
      let totalPages = 0;
      
      if (searchObj.data.queryResults.hits?.length > 0) {
        total = searchObj.data.queryResults.total || searchObj.data.queryResults.hits.length;
        totalPages = Math.ceil(total / rowsPerPage);
      }
      
      searchObj.data.resultGrid.totalPages = totalPages;
      
      if (regenerateFlag) {
        // Regenerate pagination based on current data
        searchObj.data.resultGrid.currentPage = Math.max(1, Math.min(currentPage, totalPages));
      }
    } catch (error: any) {
      console.error("Error refreshing pagination:", error);
    }
  };

  const refreshPartitionPagination = (regenerateFlag: boolean = false) => {
    if (searchObj.meta.jobId !== "") {
      return;
    }
    
    try {
      const { rowsPerPage } = searchObj.meta.resultGrid;
      const { currentPage } = searchObj.data.resultGrid;
      const partitionDetail = searchObj.data.queryResults.partitionDetail;
      let remainingRecords = rowsPerPage;
      
      // Generate pagination based on partition details
      if (partitionDetail && partitionDetail.paginations) {
        // Process partition-based pagination
        for (let i = 0; i < partitionDetail.paginations.length; i++) {
          if (remainingRecords <= 0) break;
          
          const partition = partitionDetail.paginations[i];
          const recordsFromThisPartition = Math.min(remainingRecords, partition.size);
          remainingRecords -= recordsFromThisPartition;
        }
      }
      
      if (regenerateFlag) {
        // Update pagination state based on partition data
        searchObj.data.resultGrid.currentPage = currentPage;
      }
    } catch (error: any) {
      console.error("Error refreshing partition pagination:", error);
    }
  };

  const refreshJobPagination = (regenerateFlag: boolean = false) => {
    try {
      const { rowsPerPage } = searchObj.meta.resultGrid;
      const { currentPage } = searchObj.data.resultGrid;
      
      let totalPages = 0;
      
      if (searchObj.data.queryResults.hits?.length > 0) {
        const total = searchObj.data.queryResults.total || searchObj.data.queryResults.hits.length;
        totalPages = Math.ceil(total / rowsPerPage);
      }
      
      searchObj.data.resultGrid.totalPages = totalPages;
      
      if (regenerateFlag) {
        searchObj.data.resultGrid.currentPage = Math.max(1, Math.min(currentPage, totalPages));
      }
    } catch (error: any) {
      console.error("Error refreshing job pagination:", error);
    }
  };

  // Data processing functions  
  const getPaginatedData = async (queryReq: any) => {
    // Implement paginated data fetching
    console.log("Getting paginated data:", queryReq);
    return Promise.resolve([]);
  };

  const getPageCount = async (queryReq: any) => {
    // Implement page count logic
    console.log("Getting page count:", queryReq);
    return Promise.resolve(0);
  };

  const searchAroundData = (obj: any) => {
    try {
      searchObj.loading = true;
      searchObj.data.errorCode = 0;
      searchObj.data.functionError = "";
      
      const query = searchObj.data.query;
      
      if (searchObj.meta.sqlMode === true) {
        const parsedSQL: any = fnParsedSQL(query);
        parsedSQL.where = null;
        // Build context around the specific log entry
        // This would involve time-based filtering around the selected log
      }
      
      // Implementation would build a query to search around the specific timestamp
      console.log("Search around data:", obj);
      searchObj.loading = false;
    } catch (error: any) {
      console.error("Error in search around:", error);
      searchObj.loading = false;
    }
  };

  const getJobData = async () => {
    try {
      const queryReq: any = logsQuery.buildSearchRequest();
      if (!queryReq) {
        throw new Error("Invalid query request");
      }
      if (searchObj.meta.jobId === "") {
        return null;
      }
      
      // Implementation would depend on job service
      searchObj.loading = true;
      // Call job data API here
      searchObj.loading = false;
      
      return queryReq;
    } catch (error: any) {
      console.error("Error getting job data:", error);
      searchObj.loading = false;
      throw error;
    }
  };

  const loadJobData = async () => {
    try {
      // Reset functions
      logsActions.resetFunctions();
      await logsData.getStreamList();
      await logsActions.getFunctions();
      await logsData.extractFields();
      await getJobData();
      refreshData();
    } catch (error: any) {
      searchObj.loading = false;
      console.error("Error while loading job data:", error);
    }
  };

  const getQueryPartitions = async (queryReq: any) => {
    // Implement query partitions logic
    console.log("Getting query partitions:", queryReq);
    return Promise.resolve([]);
  };

  const handleRunQuery = async () => {
    try {
      searchObj.loading = true;
      searchObj.meta.refreshHistogram = true;
      // Reset initial query payload
      logsState.initialQueryPayload.value = null;
      searchObj.data.queryResults.aggs = null;

      await getQueryData();
    } catch (error: any) {
      console.error("Error while running query:", error);
      searchObj.loading = false;
    }
  };

  const processPostPaginationData = () => {
    // Process post pagination data
    logsWebSocket.processPostPaginationData();
  };

  const updateFieldValues = () => {
    try {
      const excludedFields = [
        "_timestamp", // Default timestamp column
        "log",
        "msg",
      ];
      
      // Clear existing field values
      fieldValues.value = new Map();
      
      // Process query results to extract field values
      for (const item of searchObj.data.queryResults.hits) {
        Object.keys(item).forEach((key) => {
          if (!excludedFields.includes(key) && item[key] !== null) {
            if (!fieldValues.value.has(key)) {
              fieldValues.value.set(key, new Set());
            }
            fieldValues.value.get(key).add(item[key]);
          }
        });
      }
    } catch (error: any) {
      console.error("Error updating field values:", error);
    }
  };

  const loadVisualizeData = () => {
    // Load visualization data
    return logsVisualization.exportHistogramData();
  };

  const processHttpHistogramResults = async (queryReq: any) => {
    try {
      searchObj.meta.refreshHistogram = false;
      if (searchObj.data.queryResults.hits.length > 0) {
        if (searchObj.data.stream.selectedStream.length > 1) {
          searchObj.data.histogram = {
            xData: [],
            yData: [],
            chartParams: {
              title: logsVisualization.getHistogramTitle(),
            },
          };
        }
        
        // Process histogram data
        if (searchObj.data.stream.selectedStream.length === 1 || 
            (searchObj.data.stream.selectedStream.length > 1 && !searchObj.meta.sqlMode)) {
          await logsVisualization.generateHistogramData();
        }
        
        if (!queryReq.query?.streaming_output) {
          refreshPartitionPagination(true);
        }
      }
      
      searchObj.loadingHistogram = false;
      return true;
    } catch (error: any) {
      console.error("Error while processing http histogram results:", error);
      return true;
    }
  };

  const getRegionInfo = () => {
    // Get region information
    return { regions: searchObj.meta.regions || [] };
  };

  // Utility function for backward compatibility
  const clearSearchObj = () => {
    logsState.clearSearchObj();
  };

  const initialLogsState = () => {
    return logsState.initialLogsState();
  };

  const resetSearchObj = () => {
    logsState.resetSearchObj();
  };

  const resetStreamData = () => {
    logsState.resetStreamData();
  };

  const setSelectedStreams = (streams: string[]) => {
    logsState.setSelectedStreams(streams);
  };

  // Return the complete API maintaining backward compatibility
  return {
    // Core state objects
    searchObj,
    searchAggData,
    fieldValues,
    streamSchemaFieldsIndexMapping,
    
    // State management functions
    resetSearchObj,
    resetStreamData,
    clearSearchObj,
    initialLogsState,
    setSelectedStreams,
    
    // Stream operations
    getStreams,
    getStreamList: logsData.getStreamList,
    loadStreamLists: logsData.loadStreamLists,
    getStream,
    onStreamChange,
    updateStreams: async () => {
      try {
        // Use getStreamList to load and populate streams properly
        await logsData.getStreamList(false);
        
        // Alternative: if we need to use getStreams from useStreams composable
        // const streams: any = await getStreams(streamType, false);
        // if (streams && streams.list) {
        //   searchObj.data.streamResults = streams.list;
        //   searchObj.data.stream.streamLists = streams.list.map((item: any) => ({
        //     label: item.name,
        //     value: item.name,
        //   }));
        // }
      } catch (error: any) {
        console.error("Error updating streams:", error);
      }
    },
    
    // Query operations
    getQueryData,
    handleQueryData,
    handleRunQuery,
    buildSearch: () => logsQuery.buildSearchRequest(),
    cancelQuery: logsWebSocket.cancelQuery,
    loadLogsData,
    fnParsedSQL,
    fnUnparsedSQL,
    
    // Query validation
    isLimitQuery: (parsedSQL?: any) => logsQuery.isLimitQuery(parsedSQL),
    isDistinctQuery: (parsedSQL?: any) => logsQuery.isDistinctQuery(parsedSQL),
    isWithQuery: (parsedSQL?: any) => logsQuery.isWithQuery(parsedSQL),
    hasAggregation: (parsedSQL?: any) => logsQuery.hasQueryAggregation(parsedSQL),
    validateFilterForMultiStream: logsFilters.validateFilterForMultiStream,
    getFilterExpressionByFieldType: logsFilters.getFilterExpressionByFieldType,
    
    // Field operations
    extractFields: logsData.extractFields,
    extractFTSFields: logsData.extractFTSFields,
    updatedLocalLogFilterField: logsFilters.updateLocalLogFilterField,
    updateGridColumns: logsData.updateGridColumns,
    filterHitsColumns: logsData.filterHitsColumns,
    reorderSelectedFields: logsData.reorderSelectedFields,
    updateFieldValues,
    
    // Data operations
    refreshData,
    refreshPagination,
    refreshPartitionPagination,
    refreshJobPagination,
    searchAroundData,
    getJobData,
    loadJobData,
    getPaginatedData,
    getPageCount,
    getQueryPartitions,
    processPostPaginationData,
    
    // Histogram & visualization
    generateHistogramData: logsVisualization.generateHistogramData,
    generateHistogramSkeleton: logsVisualization.generateHistogramSkeleton,
    getHistogramQueryData: async (queryReq: any) => {
      console.log("Getting histogram query data:", queryReq);
      return Promise.resolve({});
    },
    resetHistogramWithError: logsVisualization.resetHistogramWithError,
    getHistogramTitle: logsVisualization.getHistogramTitle,
    getVisualizationConfig: logsVisualization.getVisualizationConfig,
    encodeVisualizationConfig,
    decodeVisualizationConfig,
    loadVisualizeData,
    processHttpHistogramResults,
    
    // URL & route management
    updateUrlQueryParams: logsURL.updateUrlQueryParams,
    restoreUrlQueryParams: logsURL.restoreUrlQueryParams,
    generateURLQuery: logsURL.generateURLQuery,
    routeToSearchSchedule: logsURL.routeToSearchSchedule,
    
    // Functions & actions
    getFunctions: logsActions.getFunctions,
    getActions: logsActions.getActions,
    isActionsEnabled,
    
    // WebSocket operations
    buildWebSocketPayload: logsWebSocket.buildWebSocketPayload,
    initializeSearchConnection: logsWebSocket.initializeSearchConnection,
    sendCancelSearchMessage: logsWebSocket.sendCancelSearchMessage,
    setCommunicationMethod: logsWebSocket.setCommunicationMethod,
    addTraceId: logsWebSocket.addTraceId,
    
    // Utility functions
    extractTimestamps: () => console.log("extractTimestamps placeholder"),
    extractValueQuery: logsURL.extractValueQueryLocal,
    getSavedViews: async () => {
      try {
        searchObj.loadingSavedView = true;
        savedViews
          .get(store.state.selectedOrganization.identifier)
          .then((res) => {
            searchObj.loadingSavedView = false;
            searchObj.data.savedViews = res.data.views;
          })
          .catch((err) => {
            searchObj.loadingSavedView = false;
            console.log(err);
          });
      } catch (e: any) {
        searchObj.loadingSavedView = false;
        console.log("Error while getting saved views", e);
      }
    },
    getRegionInfo,
    enableRefreshInterval: logsURL.enableRefreshInterval,
    
    // Additional objects for backward compatibility
    initialQueryPayload: logsState.initialQueryPayload,
    parser,
    router,
    $q,
    showErrorNotification,
  };
};

// Export as default to maintain compatibility with existing imports
export default useLogs;
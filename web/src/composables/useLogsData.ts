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

import { ref, reactive, computed } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import type { SearchRequestPayload, WebSocketSearchPayload, WebSocketSearchResponse } from "@/ts/interfaces";
import { useLogsState } from "@/composables/useLogsState";
import streamService from "@/services/stream";
import { logsApi } from "@/services/logs/logsApi";
import { savedViewsApi } from "@/services/logs/savedViewsApi";
import useSqlSuggestions from "@/composables/useSuggestions";
import {
  formatLogDataUtil,
  flattenObjectUtil,
  groupDataByFieldUtil,
  mapDataToFieldsUtil,
  encodeBase64Util,
  decodeBase64Util,
} from "@/utils/logs/formatters";
import {
  extractTimestampsUtil,
  calculateDatetimeRangeUtil,
  formatTimestampUtil,
} from "@/utils/logs/datetime";
import {
  chunkedAppend,
  processStreamDataUtil,
  transformLogDataUtil,
} from "@/utils/logs/transformers";
import { createSQLParserFunctions } from "@/utils/logs/parsers";
import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql";
import { validateAggregationQuery } from "@/utils/logs/validators";
import useNotifications from "@/composables/useNotifications";

interface StreamData {
  [key: string]: any;
}

interface FieldData {
  [key: string]: any;
}

/**
 * Data processing composable for logs functionality
 * Contains all data processing, stream management, and field extraction operations
 */
export const useLogsData = () => {
  const store = useStore();
  const router = useRouter();
  const { updateFieldKeywords } = useSqlSuggestions();
  const { showErrorNotification } = useNotifications();
  const { 
    searchObj, 
    searchAggData, 
    fieldValues,
    streamSchemaFieldsIndexMapping 
  } = useLogsState();

  // Initialize SQL parser
  let parser: any = null;
  try {
    parser = new Parser();
  } catch (error) {
    console.warn("Parser initialization failed:", error);
  }
  
  // Create SQL parser functions
  const { parseSQL: fnParsedSQL } = createSQLParserFunctions(parser);

  // Field values reference for autocomplete
  const processedFieldValues = ref<FieldData>({});

  /**
   * Extract and process stream data
   */
  const getStreams = async (streamName: string = "", isFirstLoad: boolean = false) => {
    try {
      if (isFirstLoad) {
        searchObj.data.stream.loading = true;
      }

      const orgIdentifier = store.state.selectedOrganization?.identifier;
      if (!orgIdentifier) {
        throw new Error("No organization selected");
      }

      const streamType = searchObj.data.stream.streamType || "logs";
      const response = await streamService.nameList(orgIdentifier, streamType, streamName);

      if (response.data.list.length === 0) {
        searchObj.data.errorMsg = "No stream found in selected organization!";
        searchObj.data.stream.streamLists = [];
        return [];
      }

      // Process and transform stream data
      const streamData = processStreamDataUtil(response.data.list);
      searchObj.data.stream.streamLists = streamData;
      
      // Update field keywords for SQL suggestions
      updateFieldKeywords();
      
      return streamData;
    } catch (error: any) {
      console.error("Error fetching streams:", error);
      searchObj.data.errorMsg = error.message || "Error fetching streams";
      return [];
    } finally {
      if (isFirstLoad) {
        searchObj.data.stream.loading = false;
      }
    }
  };

  /**
   * Get detailed stream list with fields
   */
  const getStreamList = async (selectStream: boolean = true) => {
    try {
      const orgIdentifier = store.state.selectedOrganization?.identifier;
      if (!orgIdentifier) {
        return;
      }

      const streamType = searchObj.data.stream.streamType || "logs";
      const response = await streamService.nameList(orgIdentifier, streamType, "");

      if (response.data.list?.length) {
        for (const item of response.data.list) {
          const itemIdentifier = `${orgIdentifier}_${item.name}_${streamType}`;
          
          // Get stream fields
          const fieldsResponse = await streamService.schema(
            orgIdentifier,
            item.name,
            streamType
          );
          
          item.schema = fieldsResponse.data;
          
          // Process fields with index mapping
          const fields = fieldsResponse.data.fields || [];
          streamSchemaFieldsIndexMapping.value[itemIdentifier] = {};
          
          fields.forEach((field: any, index: number) => {
            streamSchemaFieldsIndexMapping.value[itemIdentifier][field.name] = index;
          });
        }

        searchObj.data.stream.streamLists = response.data.list;
        
        if (selectStream && searchObj.data.stream.streamLists.length > 0) {
          if (searchObj.data.stream.selectedStream.length === 0) {
            searchObj.data.stream.selectedStream.push({
              label: searchObj.data.stream.streamLists[0].name,
              value: searchObj.data.stream.streamLists[0].name,
            });
          }
        }
      }
    } catch (error: any) {
      console.error("Error in getStreamList:", error);
      searchObj.data.errorMsg = error.message || "Error loading stream list";
    }
  };

  /**
   * Extract and process fields from search results
   */
  const extractFields = () => {
    try {
      const fieldsSet = new Set<string>();
      
      if (searchObj.data.queryResults.hits) {
        for (const hit of searchObj.data.queryResults.hits) {
          if (hit._source) {
            Object.keys(hit._source).forEach(key => fieldsSet.add(key));
          }
        }
      }
      
      return Array.from(fieldsSet).sort();
    } catch (error: any) {
      console.error("Error extracting fields:", error);
      return [];
    }
  };

  /**
   * Update field values for autocomplete
   */
  const updateFieldValues = () => {
    try {
      const fieldValueMap: FieldData = {};
      
      for (const item of searchObj.data.queryResults.hits) {
        if (item._source) {
          Object.entries(item._source).forEach(([key, value]) => {
            if (!fieldValueMap[key]) {
              fieldValueMap[key] = new Set();
            }
            
            if (value !== null && value !== undefined) {
              fieldValueMap[key].add(String(value));
            }
          });
        }
      }

      // Convert Sets to Arrays for easier usage
      Object.keys(fieldValueMap).forEach(key => {
        fieldValueMap[key] = Array.from(fieldValueMap[key]).slice(0, 100); // Limit to 100 values
      });

      processedFieldValues.value = fieldValueMap;
      fieldValues.value = fieldValueMap;
    } catch (error: any) {
      console.error("Error updating field values:", error);
    }
  };

  /**
   * Filter hits columns based on selected fields
   */
  const filterHitsColumns = () => {
    try {
      if (!searchObj.data.stream.selectedFields.length) {
        return searchObj.data.queryResults.hits;
      }

      return searchObj.data.queryResults.hits.map((hit: any) => {
        if (!hit._source) return hit;

        const filteredSource: any = {};
        searchObj.data.stream.selectedFields.forEach((field: string) => {
          if (hit._source.hasOwnProperty(field)) {
            filteredSource[field] = hit._source[field];
          }
        });

        return {
          ...hit,
          _source: filteredSource
        };
      });
    } catch (error: any) {
      console.error("Error filtering hits columns:", error);
      return searchObj.data.queryResults.hits;
    }
  };

  /**
   * Update grid columns configuration
   */
  const updateGridColumns = () => {
    try {
      const allFields = extractFields();
      const selectedFields = searchObj.data.stream.selectedFields;
      
      // Create column configuration
      const columns = allFields.map((field: string) => ({
        name: field,
        label: field,
        field: (row: any) => row._source?.[field],
        align: "left" as const,
        sortable: true,
        visible: selectedFields.length === 0 || selectedFields.includes(field)
      }));

      searchObj.data.resultGrid = {
        ...searchObj.data.resultGrid,
        columns
      };
    } catch (error: any) {
      console.error("Error updating grid columns:", error);
    }
  };

  /**
   * Process and update search results
   */
  const updateResult = async (
    queryReq: SearchRequestPayload, 
    response: any, 
    isPagination: boolean, 
    appendResult: boolean = false
  ) => {
    try {
      if (!response) return;

      // Handle different response types
      if (response.hits !== undefined) {
        await handleLogsResponse(queryReq, response, isPagination, appendResult);
      }
      
      if (response.aggs !== undefined) {
        handleHistogramResponse(queryReq, response);
      }
      
      if (response.total !== undefined) {
        handlePageCountResponse(queryReq, response);
      }

      // Update field values after processing results
      updateFieldValues();
      updateGridColumns();
      
    } catch (error: any) {
      console.error("Error updating results:", error);
      searchObj.data.errorMsg = error.message || "Error processing search results";
    }
  };

  /**
   * Handle logs response data
   */
  const handleLogsResponse = async (
    queryReq: SearchRequestPayload,
    response: any,
    isPagination: boolean,
    appendResult: boolean = false
  ) => {
    try {
      const hits = response.hits || [];
      
      if (isPagination || appendResult) {
        // Append to existing results
        await chunkedAppend(searchObj.data.queryResults.hits, hits);
      } else {
        // Replace results
        searchObj.data.queryResults.hits = hits;
      }

      // Update totals
      searchObj.data.queryResults.total = response.total || hits.length;
      
      // Process aggregation if present
      if (response.aggs) {
        handleAggregation(queryReq, response);
      }

      // Handle function errors if present
      if (response.function_error) {
        handleFunctionError(queryReq, response);
      }

    } catch (error: any) {
      console.error("Error handling logs response:", error);
      throw error;
    }
  };

  /**
   * Handle histogram response data
   */
  const handleHistogramResponse = (queryReq: SearchRequestPayload, response: any) => {
    try {
      if (!response.aggs) return;

      const histogramData = transformLogDataUtil(response.aggs);
      
      searchObj.data.histogram = {
        ...searchObj.data.histogram,
        data: histogramData,
        loading: false,
        errorCode: 0,
        errorMsg: ""
      };

    } catch (error: any) {
      console.error("Error handling histogram response:", error);
      searchObj.data.histogram.errorMsg = error.message || "Error processing histogram data";
    }
  };

  /**
   * Handle page count response data
   */
  const handlePageCountResponse = (queryReq: SearchRequestPayload, response: any) => {
    try {
      const total = response.total || 0;
      searchObj.data.queryResults.total = total;
      
      // Update pagination info
      if (searchObj.data.resultGrid) {
        searchObj.data.resultGrid.total = total;
      }

    } catch (error: any) {
      console.error("Error handling page count response:", error);
    }
  };

  /**
   * Handle aggregation data
   */
  const handleAggregation = (queryReq: SearchRequestPayload, response: any) => {
    try {
      const parsedSQL = fnParsedSQL(searchObj.data.query);
      
      if (parsedSQL && hasAggregation(parsedSQL.columns)) {
        // Process aggregation results
        const aggData = response.aggs || {};
        
        Object.assign(searchAggData, {
          ...aggData,
          total: response.total || 0
        });
      }
    } catch (error: any) {
      console.error("Error handling aggregation:", error);
    }
  };

  /**
   * Handle function execution errors
   */
  const handleFunctionError = (queryReq: SearchRequestPayload, response: any) => {
    try {
      const functionError = response.function_error;
      
      if (functionError) {
        searchObj.data.errorMsg = `Function Error: ${functionError}`;
        searchObj.data.errorCode = 1;
        showErrorNotification(searchObj.data.errorMsg);
      }
    } catch (error: any) {
      console.error("Error handling function error:", error);
    }
  };

  /**
   * Process post-pagination data
   */
  const processPostPaginationData = () => {
    try {
      const { rowsPerPage } = searchObj.meta.resultGrid;
      const { currentPage } = searchObj.data.resultGrid;
      
      if (!searchObj.data.queryResults.partitionDetail) {
        return;
      }

      const partitionDetail = searchObj.data.queryResults.partitionDetail;
      const startIndex = currentPage * rowsPerPage;
      const endIndex = startIndex + rowsPerPage;

      // Process partition data for current page
      if (partitionDetail.paginations && partitionDetail.paginations.length > 0) {
        const currentPartition = Math.floor(startIndex / partitionDetail.partition_size);
        const partitionData = partitionDetail.paginations[currentPartition] || [];
        
        // Extract data for current page
        const pageData = partitionData.slice(
          startIndex % partitionDetail.partition_size,
          Math.min(endIndex % partitionDetail.partition_size, partitionData.length)
        );

        searchObj.data.queryResults.hits = pageData;
      }
    } catch (error: any) {
      console.error("Error processing post-pagination data:", error);
    }
  };

  /**
   * Extract Full-Text Search (FTS) fields
   */
  const extractFTSFields = () => {
    try {
      const ftsFields: string[] = [];
      
      if (searchObj.data.stream.selectedStreamFields) {
        for (const field of searchObj.data.stream.selectedStreamFields) {
          if (field.fts_key === true) {
            ftsFields.push(field.name);
          }
        }
      }

      return ftsFields;
    } catch (error: any) {
      console.error("Error extracting FTS fields:", error);
      return [];
    }
  };

  /**
   * Update selected streams
   */
  const updateStreams = async () => {
    try {
      const orgIdentifier = store.state.selectedOrganization?.identifier;
      if (!orgIdentifier) return;

      const streamType = searchObj.data.stream.streamType || "logs";
      
      // Get fresh stream data
      const response = await streamService.nameList(orgIdentifier, streamType, "");
      
      if (response.data.list?.length) {
        // Update stream lists with fresh data
        searchObj.data.stream.streamLists = response.data.list;
        
        // Validate selected streams still exist
        const availableStreams = response.data.list.map((s: any) => s.name);
        const validSelectedStreams = searchObj.data.stream.selectedStream.filter(
          (stream: any) => availableStreams.includes(stream.value || stream.name)
        );
        
        if (validSelectedStreams.length !== searchObj.data.stream.selectedStream.length) {
          searchObj.data.stream.selectedStream = validSelectedStreams;
        }
      }
    } catch (error: any) {
      console.error("Error updating streams:", error);
      searchObj.data.errorMsg = error.message || "Error updating streams";
    }
  };

  /**
   * Load stream lists with caching
   */
  const loadStreamLists = async () => {
    try {
      // Check if already loaded
      if (searchObj.data.stream.streamLists.length > 0) {
        return searchObj.data.stream.streamLists;
      }

      return await getStreamList(true);
    } catch (error: any) {
      console.error("Error loading stream lists:", error);
      return [];
    }
  };

  /**
   * Set selected streams
   */
  const setSelectedStreams = (streams: any[]) => {
    try {
      searchObj.data.stream.selectedStream = streams;
      
      // Update selected stream fields
      if (streams.length > 0) {
        updateSelectedStreamFields();
      }
    } catch (error: any) {
      console.error("Error setting selected streams:", error);
    }
  };

  /**
   * Update selected stream fields based on selected streams
   */
  const updateSelectedStreamFields = async () => {
    try {
      const orgIdentifier = store.state.selectedOrganization?.identifier;
      if (!orgIdentifier || !searchObj.data.stream.selectedStream.length) {
        return;
      }

      const streamType = searchObj.data.stream.streamType || "logs";
      const allFields: any[] = [];

      // Get fields for each selected stream
      for (const stream of searchObj.data.stream.selectedStream) {
        const streamName = stream.value || stream.name;
        
        try {
          const fieldsResponse = await streamService.schema(
            orgIdentifier,
            streamName,
            streamType
          );
          
          if (fieldsResponse.data?.fields) {
            allFields.push(...fieldsResponse.data.fields);
          }
        } catch (fieldError) {
          console.warn(`Error getting fields for stream ${streamName}:`, fieldError);
        }
      }

      // Remove duplicates and sort
      const uniqueFields = allFields.filter((field, index, arr) => 
        arr.findIndex(f => f.name === field.name) === index
      );

      searchObj.data.stream.selectedStreamFields = uniqueFields.sort((a, b) => 
        a.name.localeCompare(b.name)
      );

    } catch (error: any) {
      console.error("Error updating selected stream fields:", error);
    }
  };

  /**
   * Reorder selected fields
   */
  const reorderSelectedFields = (fields: string[]) => {
    try {
      searchObj.data.stream.selectedFields = fields;
      updateGridColumns();
    } catch (error: any) {
      console.error("Error reordering selected fields:", error);
    }
  };

  /**
   * Check if query has aggregation functions
   */
  const hasAggregation = (columns: any) => {
    try {
      return validateAggregationQuery({ columns }, searchObj.data.query);
    } catch (error: any) {
      console.error("Error checking aggregation:", error);
      return false;
    }
  };

  return {
    // Stream operations
    getStreams,
    getStreamList,
    loadStreamLists,
    updateStreams,
    setSelectedStreams,
    updateSelectedStreamFields,
    
    // Field operations
    extractFields,
    extractFTSFields,
    updateFieldValues,
    reorderSelectedFields,
    
    // Data processing
    updateResult,
    handleLogsResponse,
    handleHistogramResponse,
    handlePageCountResponse,
    handleAggregation,
    handleFunctionError,
    
    // Grid and filtering
    filterHitsColumns,
    updateGridColumns,
    processPostPaginationData,
    
    // Utility functions
    hasAggregation,
    
    // State
    processedFieldValues,
  };
};

export default useLogsData;
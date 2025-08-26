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

import { ref, computed } from "vue";
import { useStore } from "vuex";
import { useLogsState } from "@/composables/useLogsState";
import { histogramDateTimezone } from "@/utils/zincutils";
import { INTERVAL_MAP } from "@/utils/logs/constants";
import {
  generateHistogramTitle,
  type HistogramTitleParams
} from "@/utils/logs/formatters";
import {
  createSQLParserFunctions
} from "@/utils/logs/parsers";
import {
  validateAggregationQuery
} from "@/utils/logs/validators";

interface ChartParams {
  title: string;
  unparsed_x_data: any[];
  timezone: string;
}

interface HistogramData {
  xData: number[];
  yData: number[];
  chartParams: ChartParams;
  errorCode: number;
  errorMsg: string;
  errorDetail: string;
}

interface VisualizationConfig {
  config: any;
  type: string;
}

interface HistogramBucket {
  zo_sql_key: string | number | Date;
  zo_sql_num: string;
}

/**
 * Visualization and histogram management composable for logs functionality
 * Contains all histogram generation, chart configuration, and visualization operations
 */
export const useLogsVisualization = () => {
  const store = useStore();
  const { searchObj } = useLogsState();

  // State for histogram processing
  const histogramResults = ref<any[]>([]);
  const histogramMappedData = ref<Map<any, any>>(new Map());

  // SQL Parser functions (using mock parser for consistency with other composables)
  const mockParser = {};
  const { parseSQL: parsedSQL } = createSQLParserFunctions(mockParser);

  // Computed properties
  const isHistogramEnabled = computed(() => searchObj.meta.showHistogram);
  const isHistogramLoading = computed(() => searchObj.loadingHistogram);
  const isHistogramDirty = computed(() => searchObj.meta.histogramDirtyFlag);

  const hasHistogramData = computed(() => {
    return searchObj.data.histogram?.xData?.length > 0 || 
           searchObj.data.histogram?.yData?.length > 0;
  });

  const chartInterval = computed(() => searchObj.meta.resultGrid.chartInterval);
  const chartKeyFormat = computed(() => searchObj.meta.resultGrid.chartKeyFormat);

  const isMultiStreamSearch = computed(() => searchObj.data.stream.selectedStream.length > 1);
  const isSQLMode = computed(() => searchObj.meta.sqlMode);

  /**
   * Reset histogram data with optional error
   */
  const resetHistogramWithError = (errorMsg: string, errorCode: number = 0) => {
    try {
      searchObj.data.histogram = {
        xData: [],
        yData: [],
        chartParams: {
          title: getHistogramTitle(),
          unparsed_x_data: [],
          timezone: store.state.timezone || "",
        },
        errorCode,
        errorMsg,
        errorDetail: "",
      };
    } catch (error: any) {
      console.error("Error resetting histogram:", error);
    }
  };

  /**
   * Reset histogram error state
   */
  const resetHistogramError = () => {
    try {
      if (searchObj.data.histogram) {
        searchObj.data.histogram.errorMsg = "";
        searchObj.data.histogram.errorCode = 0;
        searchObj.data.histogram.errorDetail = "";
      }
    } catch (error: any) {
      console.error("Error resetting histogram error:", error);
    }
  };

  /**
   * Generate histogram title with current pagination and data info
   */
  const getHistogramTitle = () => {
    try {
      const params: HistogramTitleParams = {
        currentPage: searchObj.data.resultGrid.currentPage,
        rowsPerPage: searchObj.meta.resultGrid.rowsPerPage,
        totalCount: Math.max(
          searchObj.data.queryResults.hits?.length || 0,
          searchObj.data.queryResults.total || 0
        ),
        hitsLength: searchObj.data.queryResults.hits?.length || 0,
        showPagination: searchObj.meta.resultGrid.showPagination,
        communicationMethod: searchObj.communicationMethod,
      };

      return generateHistogramTitle(params);
    } catch (error: any) {
      console.error("Error generating histogram title:", error);
      return "";
    }
  };

  /**
   * Generate histogram skeleton for time-based buckets
   */
  const generateHistogramSkeleton = () => {
    try {
      if (
        searchObj.data.queryResults.hasOwnProperty("aggs") &&
        searchObj.data.queryResults.aggs
      ) {
        histogramResults.value = [];
        histogramMappedData.value = new Map();
        
        const intervalMs: any = INTERVAL_MAP[searchObj.meta.resultGrid.chartInterval];
        if (!intervalMs) {
          throw new Error("Invalid interval");
        }

        // Set histogram interval from backend or use default
        searchObj.data.histogramInterval = searchObj.data.queryResults.histogram_interval 
          ? searchObj.data.queryResults.histogram_interval * 1000000 
          : intervalMs;

        // Calculate start time and round based on interval
        const startTimeDate = new Date(
          searchObj.data.customDownloadQueryObj.query.start_time / 1000
        );

        // Round start time based on chart interval
        if (searchObj.meta.resultGrid.chartInterval.includes("second")) {
          startTimeDate.setSeconds(startTimeDate.getSeconds() > 30 ? 30 : 0, 0);
        } else if (searchObj.meta.resultGrid.chartInterval.includes("1 minute")) {
          startTimeDate.setSeconds(0, 0);
        } else if (searchObj.meta.resultGrid.chartInterval.includes("minute")) {
          const minutes = parseInt(
            searchObj.meta.resultGrid.chartInterval.replace(" minute", "")
          );
          startTimeDate.setMinutes(minutes, 0);
        } else if (searchObj.meta.resultGrid.chartInterval.includes("hour")) {
          startTimeDate.setHours(startTimeDate.getHours() + 1);
          startTimeDate.setUTCMinutes(0, 0);
        } else {
          startTimeDate.setMinutes(0, 0);
          startTimeDate.setUTCHours(0, 0, 0);
          startTimeDate.setDate(startTimeDate.getDate() + 1);
        }

        const startTime = startTimeDate.getTime() * 1000;
        return startTime;
      }
    } catch (error: any) {
      console.error("Error generating histogram skeleton:", error);
      throw error;
    }
  };

  /**
   * Generate histogram data from aggregation results
   */
  const generateHistogramData = () => {
    try {
      let num_records: number = 0;
      const unparsed_x_data: any[] = [];
      const xData: number[] = [];
      const yData: number[] = [];
      let hasAggregationFlag = false;

      // Check for SQL aggregation
      const parsed: any = parsedSQL(searchObj.data.query);
      if (searchObj.meta.sqlMode && parsed?.hasOwnProperty("columns")) {
        hasAggregationFlag = hasAggregation(parsed.columns);
      }

      // Process aggregation data
      if (
        searchObj.data.queryResults.hasOwnProperty("aggs") &&
        searchObj.data.queryResults.aggs
      ) {
        // Create map of existing histogram results
        histogramMappedData.value = new Map(
          histogramResults.value.map((item: any) => [
            item.zo_sql_key,
            JSON.parse(JSON.stringify(item)),
          ])
        );

        // Merge new aggregation data with existing results
        searchObj.data.queryResults.aggs.forEach((item: any) => {
          if (histogramMappedData.value.has(item.zo_sql_key)) {
            histogramMappedData.value.get(item.zo_sql_key).zo_sql_num += item.zo_sql_num;
          } else {
            histogramMappedData.value.set(item.zo_sql_key, item);
          }
        });

        // Convert map to array and process data
        const mergedData: any = Array.from(histogramMappedData.value.values());
        mergedData.map((bucket: HistogramBucket) => {
          num_records += parseInt(bucket.zo_sql_num, 10);
          unparsed_x_data.push(bucket.zo_sql_key);
          xData.push(
            histogramDateTimezone(bucket.zo_sql_key, store.state.timezone)
          );
          yData.push(parseInt(bucket.zo_sql_num, 10));
        });

        // Update total count
        searchObj.data.queryResults.total = num_records;
      }

      // Create chart parameters
      const chartParams: ChartParams = {
        title: getHistogramTitle(),
        unparsed_x_data,
        timezone: store.state.timezone || "",
      };

      // Update histogram data
      searchObj.data.histogram = {
        xData,
        yData,
        chartParams,
        errorCode: 0,
        errorMsg: "",
        errorDetail: "",
      };
    } catch (error: any) {
      console.error("Error while generating histogram data:", error);
      resetHistogramWithError("Error while generating histogram data.", -1);
    }
  };

  /**
   * Set multi-stream histogram query for multiple selected streams
   */
  const setMultiStreamHistogramQuery = (queryReq: any) => {
    try {
      if (!queryReq || !queryReq.query) {
        return null;
      }

      // If only one stream selected, return original query
      if (searchObj.data.stream.selectedStream.length <= 1) {
        return queryReq.query.sql;
      }

      const histogramQuery = `select histogram(${store.state.zoConfig.timestamp_column}, '${searchObj.meta.resultGrid.chartInterval}') AS zo_sql_key, count(*) AS zo_sql_num from "[INDEX_NAME]" [WHERE_CLAUSE] GROUP BY zo_sql_key`;
      const multiSql: string[] = [];

      for (const stream of searchObj.data.stream.selectedStream) {
        // Skip streams that are missing required filter fields
        if (searchObj.data.stream.missingStreamMultiStreamFilter?.includes(stream)) {
          continue;
        }

        // Get stream name - handle both object and string formats
        const streamName = typeof stream === 'string' ? stream : (stream.value || stream.name || stream);
        
        // Replace index name and where clause for each stream
        let streamQuery = histogramQuery.replace("[INDEX_NAME]", streamName);
        
        // Add where clause if filter field exists
        if (searchObj.data.stream.filterField) {
          streamQuery = streamQuery.replace(
            "[WHERE_CLAUSE]", 
            `WHERE ${searchObj.data.stream.filterField}`
          );
        } else {
          streamQuery = streamQuery.replace("[WHERE_CLAUSE]", "");
        }

        multiSql.push(streamQuery);
      }

      return multiSql.length > 0 ? multiSql.join(" UNION ALL ") : queryReq.query.sql;
    } catch (error: any) {
      console.error("Error setting multi-stream histogram query:", error);
      return queryReq?.query?.sql || null;
    }
  };

  /**
   * Check if histogram should be displayed based on current conditions
   */
  const shouldShowHistogram = (parsedSQL: any) => {
    try {
      // Check if histogram is enabled and conditions are met
      const isHistogramMissing = !hasHistogramData.value;
      const isHistogramEnabledCheck = searchObj.meta.showHistogram;
      const isValidSQLMode = !searchObj.meta.sqlMode || 
        (searchObj.meta.sqlMode && !hasLimitQuery(parsedSQL) && !hasDistinctQuery(parsedSQL) && !hasWithQuery(parsedSQL));
      const isValidStreamCount = searchObj.data.stream.selectedStream.length === 1 || 
        (searchObj.data.stream.selectedStream.length > 1 && !searchObj.meta.sqlMode);

      return ((isHistogramMissing && isHistogramEnabledCheck && isValidSQLMode) ||
              (isHistogramEnabledCheck && !searchObj.meta.sqlMode)) &&
              isValidStreamCount;
    } catch (error: any) {
      console.error("Error checking if histogram should show:", error);
      return false;
    }
  };

  /**
   * Check if query is a LIMIT query
   */
  const hasLimitQuery = (parsedSQL: any) => {
    return parsedSQL?.limit != null;
  };

  /**
   * Check if query is a DISTINCT query
   */
  const hasDistinctQuery = (parsedSQL: any) => {
    return parsedSQL?.distinct != null;
  };

  /**
   * Check if query is a WITH query
   */
  const hasWithQuery = (parsedSQL: any) => {
    return parsedSQL?.with != null;
  };

  /**
   * Get visualization configuration from dashboard panel data
   */
  const getVisualizationConfig = (dashboardPanelData: any): VisualizationConfig | null => {
    try {
      if (!dashboardPanelData?.data) {
        return null;
      }
      
      // Only store config object and chart type
      return {
        config: dashboardPanelData.data.config || {},
        type: dashboardPanelData.data.type || 'bar',
      };
    } catch (error: any) {
      console.error("Error getting visualization config:", error);
      return null;
    }
  };

  /**
   * Set chart interval and key format based on time range
   */
  const setChartInterval = (timeIntervalData: any) => {
    try {
      searchObj.meta.resultGrid.chartInterval = timeIntervalData.interval;
      searchObj.meta.resultGrid.chartKeyFormat = timeIntervalData.keyFormat;
    } catch (error: any) {
      console.error("Error setting chart interval:", error);
    }
  };

  /**
   * Initialize histogram data structure
   */
  const initializeHistogram = () => {
    try {
      searchObj.data.histogram = {
        xData: [],
        yData: [],
        chartParams: {
          title: "",
          unparsed_x_data: [],
          timezone: store.state.timezone || "",
        },
        errorCode: 0,
        errorMsg: "",
        errorDetail: "",
      };
    } catch (error: any) {
      console.error("Error initializing histogram:", error);
    }
  };

  /**
   * Clear histogram data and reset state
   */
  const clearHistogramData = () => {
    try {
      histogramResults.value = [];
      histogramMappedData.value = new Map();
      initializeHistogram();
    } catch (error: any) {
      console.error("Error clearing histogram data:", error);
    }
  };

  /**
   * Update histogram title after data changes
   */
  const updateHistogramTitle = () => {
    try {
      if (searchObj.data.histogram?.chartParams) {
        searchObj.data.histogram.chartParams.title = getHistogramTitle();
      }
    } catch (error: any) {
      console.error("Error updating histogram title:", error);
    }
  };

  /**
   * Get histogram statistics
   */
  const getHistogramStats = () => {
    try {
      const histogram = searchObj.data.histogram;
      if (!histogram) return null;

      const totalDataPoints = histogram.xData?.length || 0;
      const totalCount = histogram.yData?.reduce((sum, val) => sum + val, 0) || 0;
      const maxValue = histogram.yData?.length ? Math.max(...histogram.yData) : 0;
      const minValue = histogram.yData?.length ? Math.min(...histogram.yData) : 0;
      const avgValue = totalDataPoints > 0 ? totalCount / totalDataPoints : 0;

      return {
        totalDataPoints,
        totalCount,
        maxValue,
        minValue,
        avgValue,
        hasData: totalDataPoints > 0,
        hasError: histogram.errorCode !== 0,
        errorMessage: histogram.errorMsg,
      };
    } catch (error: any) {
      console.error("Error getting histogram stats:", error);
      return null;
    }
  };

  /**
   * Validate histogram interval
   */
  const validateHistogramInterval = (interval: string) => {
    try {
      return INTERVAL_MAP.hasOwnProperty(interval);
    } catch (error: any) {
      console.error("Error validating histogram interval:", error);
      return false;
    }
  };

  /**
   * Format histogram data for export
   */
  const exportHistogramData = () => {
    try {
      const histogram = searchObj.data.histogram;
      if (!histogram || !histogram.xData?.length) {
        return null;
      }

      return histogram.xData.map((timestamp, index) => ({
        timestamp,
        count: histogram.yData[index] || 0,
        formatted_timestamp: histogram.chartParams.unparsed_x_data[index]
      }));
    } catch (error: any) {
      console.error("Error exporting histogram data:", error);
      return null;
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
    // State
    histogramResults,
    histogramMappedData,
    
    // Computed properties
    isHistogramEnabled,
    isHistogramLoading,
    isHistogramDirty,
    hasHistogramData,
    chartInterval,
    chartKeyFormat,
    isMultiStreamSearch,
    isSQLMode,
    
    // Core histogram operations
    generateHistogramData,
    generateHistogramSkeleton,
    resetHistogramWithError,
    resetHistogramError,
    initializeHistogram,
    clearHistogramData,
    
    // Query operations
    setMultiStreamHistogramQuery,
    shouldShowHistogram,
    hasLimitQuery,
    hasDistinctQuery,
    hasWithQuery,
    hasAggregation,
    
    // Chart configuration
    getHistogramTitle,
    updateHistogramTitle,
    setChartInterval,
    getVisualizationConfig,
    
    // Utility functions
    getHistogramStats,
    validateHistogramInterval,
    exportHistogramData,
  };
};

export default useLogsVisualization;
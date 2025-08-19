/**
 * useLogsHistogramManagement.ts
 * 
 * Manages histogram generation, data processing, and visualization for the logs module.
 * Handles time-based aggregations, chart data formatting, and histogram-specific queries.
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { useStore } from 'vuex';
import { date } from 'quasar';
import {
  histogramDateTimezone,
  timestampToTimezoneDate,
} from '@/utils/zincutils';
import type { 
  UseLogsHistogramManagement,
  SearchObject
} from './INTERFACES_AND_TYPES';

/**
 * Histogram Management Composable
 * 
 * Provides comprehensive histogram management functionality including:
 * - Histogram data generation and processing
 * - Time-based aggregation handling
 * - Chart data formatting and preparation
 * - Histogram query building
 * - Timezone and date formatting
 * - Multi-stream histogram support
 */
export default function useLogsHistogramManagement(
  searchObj: Ref<SearchObject>
): UseLogsHistogramManagement {
  const store = useStore();

  // ========================================
  // REACTIVE STATE
  // ========================================

  // Histogram configuration
  const histogramConfig = ref<{
    interval: string;
    keyFormat: string;
    timezone: string;
    showHistogram: boolean;
  }>({
    interval: '1 second',
    keyFormat: 'HH:mm:ss',
    timezone: 'UTC',
    showHistogram: true,
  });

  // Processing state
  const isProcessingHistogram = ref<boolean>(false);
  const histogramError = ref<string>('');
  const histogramSkeletonData = ref<any[]>([]);

  // Chart state
  const chartParams = ref<{
    title: string;
    unparsed_x_data: any[];
    timezone: string;
    interval: string;
    keyFormat: string;
  }>({
    title: '',
    unparsed_x_data: [],
    timezone: 'UTC',
    interval: '1 second',
    keyFormat: 'HH:mm:ss',
  });

  // ========================================
  // COMPUTED PROPERTIES
  // ========================================

  const histogramData: ComputedRef<{
    xData: any[];
    yData: number[];
    chartParams: any;
    errorCode: number;
    errorMsg: string;
    errorDetail: string;
  }> = computed(() => searchObj.value.data.histogram);

  const isHistogramEnabled: ComputedRef<boolean> = computed(() => 
    searchObj.value.meta.showHistogram && histogramConfig.value.showHistogram
  );

  const hasHistogramData: ComputedRef<boolean> = computed(() => 
    histogramData.value.xData.length > 0 && histogramData.value.yData.length > 0
  );

  const hasHistogramError: ComputedRef<boolean> = computed(() => 
    !!histogramData.value.errorMsg || !!histogramError.value
  );

  const currentInterval: ComputedRef<string> = computed(() => 
    searchObj.value.meta.resultGrid.chartInterval || '1 second'
  );

  const currentKeyFormat: ComputedRef<string> = computed(() => 
    searchObj.value.meta.resultGrid.chartKeyFormat || 'HH:mm:ss'
  );

  const timezone: ComputedRef<string> = computed(() => 
    store.state.timezone || 'UTC'
  );

  // ========================================
  // HISTOGRAM DATA PROCESSING
  // ========================================

  /**
   * Generates histogram data from aggregation results
   * 
   * @param aggregationData Raw aggregation data from search response
   * @returns Processed histogram data
   */
  const generateHistogramData = async (aggregationData: any): Promise<void> => {
    try {
      isProcessingHistogram.value = true;
      histogramError.value = '';

      // Reset histogram data
      searchObj.value.data.histogram = {
        xData: [],
        yData: [],
        chartParams: {
          title: '',
          unparsed_x_data: [],
          timezone: timezone.value,
        },
        errorCode: 0,
        errorMsg: '',
        errorDetail: '',
      };

      if (!aggregationData || !Array.isArray(aggregationData)) {
        throw new Error('Invalid aggregation data provided');
      }

      const xData: any[] = [];
      const yData: number[] = [];
      const unparsedXData: any[] = [];

      // Process each bucket in the aggregation
      for (const bucket of aggregationData) {
        if (!bucket || typeof bucket !== 'object') continue;

        const timestamp = bucket.key || bucket.zo_sql_key;
        const count = bucket.doc_count || bucket.zo_sql_num || 0;

        if (timestamp !== undefined) {
          // Format timestamp for display
          const formattedTimestamp = formatHistogramTimestamp(timestamp);
          
          xData.push(formattedTimestamp);
          yData.push(Number(count) || 0);
          unparsedXData.push(timestamp);
        }
      }

      // Update histogram data
      searchObj.value.data.histogram = {
        xData,
        yData,
        chartParams: {
          title: getHistogramTitle(),
          unparsed_x_data: unparsedXData,
          timezone: timezone.value,
        },
        errorCode: 0,
        errorMsg: '',
        errorDetail: '',
      };

      // Update chart parameters
      chartParams.value = {
        title: getHistogramTitle(),
        unparsed_x_data: unparsedXData,
        timezone: timezone.value,
        interval: currentInterval.value,
        keyFormat: currentKeyFormat.value,
      };

    } catch (error: any) {
      console.error('Error generating histogram data:', error);
      histogramError.value = error.message || 'Failed to generate histogram data';
      
      searchObj.value.data.histogram.errorMsg = histogramError.value;
      searchObj.value.data.histogram.errorCode = 1;
    } finally {
      isProcessingHistogram.value = false;
    }
  };

  /**
   * Formats timestamp for histogram display
   * 
   * @param timestamp Raw timestamp value
   * @returns Formatted timestamp string
   */
  const formatHistogramTimestamp = (timestamp: any): string => {
    try {
      // Handle different timestamp formats
      let dateValue: Date;

      if (typeof timestamp === 'number') {
        // Assume microseconds if very large number, otherwise milliseconds
        const ts = timestamp > 9999999999999 ? timestamp / 1000 : timestamp;
        dateValue = new Date(ts);
      } else if (typeof timestamp === 'string') {
        dateValue = new Date(timestamp);
      } else {
        return String(timestamp);
      }

      // Validate date
      if (isNaN(dateValue.getTime())) {
        return String(timestamp);
      }

      // Apply timezone formatting
      const formattedDate = timestampToTimezoneDate(
        dateValue.getTime() * 1000, // Convert to microseconds
        timezone.value,
        'YYYY-MM-DDTHH:mm:ss.SSSZ'
      );

      // Apply key format
      return histogramDateTimezone(
        formattedDate,
        timezone.value,
        currentKeyFormat.value
      );

    } catch (error) {
      console.error('Error formatting histogram timestamp:', error);
      return String(timestamp);
    }
  };

  /**
   * Generates histogram title based on current configuration
   */
  const getHistogramTitle = (): string => {
    const streamNames = searchObj.value.data.stream.selectedStream;
    const streamText = streamNames.length === 1 
      ? streamNames[0] 
      : `${streamNames.length} streams`;
    
    return `Event Distribution - ${streamText}`;
  };

  // ========================================
  // HISTOGRAM QUERIES
  // ========================================

  /**
   * Builds histogram-specific query for time-based aggregations
   * 
   * @param baseQuery Base search query
   * @returns Histogram query object
   */
  const buildHistogramQuery = (baseQuery: any): any => {
    try {
      const timestampColumn = store.state.zoConfig.timestamp_column || '_timestamp';
      const interval = currentInterval.value;
      
      // For SQL mode
      if (searchObj.value.meta.sqlMode) {
        const histogramSQL = buildHistogramSQLQuery(baseQuery.sql, interval, timestampColumn);
        return {
          ...baseQuery,
          sql: histogramSQL,
          size: 0, // Don't need actual records for histogram
        };
      }

      // For standard mode - build histogram aggregation
      const histogramAgg = {
        histogram: `SELECT histogram(${timestampColumn}, '${interval}') AS zo_sql_key, count(*) AS zo_sql_num FROM query GROUP BY zo_sql_key ORDER BY zo_sql_key`,
      };

      return {
        ...baseQuery,
        size: 0, // Don't need actual records for histogram
        aggs: histogramAgg,
      };

    } catch (error) {
      console.error('Error building histogram query:', error);
      return baseQuery;
    }
  };

  /**
   * Builds SQL query for histogram in SQL mode
   * 
   * @param originalSQL Original SQL query
   * @param interval Time interval for histogram
   * @param timestampColumn Timestamp column name
   * @returns Modified SQL for histogram
   */
  const buildHistogramSQLQuery = (originalSQL: string, interval: string, timestampColumn: string): string => {
    try {
      // Parse the original query to extract relevant parts
      const fromMatch = originalSQL.match(/FROM\s+([^\s]+)/i);
      const whereMatch = originalSQL.match(/WHERE\s+(.*?)(?:GROUP|ORDER|LIMIT|$)/is);
      
      const fromClause = fromMatch ? fromMatch[1] : 'logs';
      const whereClause = whereMatch ? `WHERE ${whereMatch[1].trim()}` : '';

      // Build histogram SQL
      const histogramSQL = `
        SELECT 
          histogram(${timestampColumn}, '${interval}') AS zo_sql_key, 
          count(*) AS zo_sql_num 
        FROM ${fromClause} 
        ${whereClause}
        GROUP BY zo_sql_key 
        ORDER BY zo_sql_key
      `.replace(/\s+/g, ' ').trim();

      return histogramSQL;

    } catch (error) {
      console.error('Error building histogram SQL query:', error);
      return originalSQL;
    }
  };

  /**
   * Builds multi-stream histogram query
   * 
   * @param streams Array of stream names
   * @param baseQuery Base query object
   * @returns Multi-stream histogram query
   */
  const buildMultiStreamHistogramQuery = (streams: string[], baseQuery: any): any => {
    try {
      const timestampColumn = store.state.zoConfig.timestamp_column || '_timestamp';
      const interval = currentInterval.value;

      // Build UNION ALL query for multiple streams
      const streamQueries = streams.map(stream => {
        const streamQuery = `
          SELECT 
            histogram(${timestampColumn}, '${interval}') AS zo_sql_key, 
            count(*) AS zo_sql_num,
            '${stream}' AS stream_name
          FROM "${stream}"
          ${baseQuery.whereClause ? `WHERE ${baseQuery.whereClause}` : ''}
        `;
        return streamQuery;
      });

      const unionSQL = `
        SELECT 
          zo_sql_key, 
          SUM(zo_sql_num) AS zo_sql_num 
        FROM (
          ${streamQueries.join(' UNION ALL ')}
        ) 
        GROUP BY zo_sql_key 
        ORDER BY zo_sql_key
      `.replace(/\s+/g, ' ').trim();

      return {
        ...baseQuery,
        sql: unionSQL,
        size: 0,
      };

    } catch (error) {
      console.error('Error building multi-stream histogram query:', error);
      return baseQuery;
    }
  };

  // ========================================
  // HISTOGRAM SKELETON AND PLACEHOLDERS
  // ========================================

  /**
   * Generates histogram skeleton data for loading states
   * 
   * @param startTime Start timestamp
   * @param endTime End timestamp
   * @param interval Time interval
   */
  const generateHistogramSkeleton = (
    startTime: number, 
    endTime: number, 
    interval: string = '1 second'
  ): void => {
    try {
      const skeletonData: any[] = [];
      const intervalMs = parseIntervalToMilliseconds(interval);
      
      let currentTime = startTime;
      while (currentTime <= endTime) {
        const formattedTime = formatHistogramTimestamp(currentTime);
        skeletonData.push({
          key: formattedTime,
          value: 0,
          timestamp: currentTime,
        });
        currentTime += intervalMs;
      }

      histogramSkeletonData.value = skeletonData;

      // Set skeleton as temporary histogram data
      searchObj.value.data.histogram = {
        xData: skeletonData.map(item => item.key),
        yData: skeletonData.map(item => item.value),
        chartParams: {
          title: 'Loading...',
          unparsed_x_data: skeletonData.map(item => item.timestamp),
          timezone: timezone.value,
        },
        errorCode: 0,
        errorMsg: '',
        errorDetail: '',
      };

    } catch (error) {
      console.error('Error generating histogram skeleton:', error);
    }
  };

  /**
   * Parses interval string to milliseconds
   * 
   * @param interval Interval string (e.g., '1 second', '5 minutes')
   * @returns Interval in milliseconds
   */
  const parseIntervalToMilliseconds = (interval: string): number => {
    const matches = interval.match(/(\d+)\s*(second|minute|hour|day)s?/i);
    if (!matches) return 1000; // Default to 1 second

    const value = parseInt(matches[1]);
    const unit = matches[2].toLowerCase();

    switch (unit) {
      case 'second':
        return value * 1000;
      case 'minute':
        return value * 60 * 1000;
      case 'hour':
        return value * 60 * 60 * 1000;
      case 'day':
        return value * 24 * 60 * 60 * 1000;
      default:
        return 1000;
    }
  };

  // ========================================
  // HISTOGRAM CONFIGURATION
  // ========================================

  /**
   * Updates histogram configuration
   * 
   * @param config New configuration options
   */
  const updateHistogramConfig = (config: Partial<typeof histogramConfig.value>): void => {
    histogramConfig.value = {
      ...histogramConfig.value,
      ...config,
    };

    // Update search object meta
    if (config.showHistogram !== undefined) {
      searchObj.value.meta.showHistogram = config.showHistogram;
    }
    if (config.interval) {
      searchObj.value.meta.resultGrid.chartInterval = config.interval;
    }
    if (config.keyFormat) {
      searchObj.value.meta.resultGrid.chartKeyFormat = config.keyFormat;
    }
  };

  /**
   * Resets histogram data to initial state
   */
  const resetHistogramData = (): void => {
    searchObj.value.data.histogram = {
      xData: [],
      yData: [],
      chartParams: {
        title: '',
        unparsed_x_data: [],
        timezone: timezone.value,
      },
      errorCode: 0,
      errorMsg: '',
      errorDetail: '',
    };

    histogramError.value = '';
    histogramSkeletonData.value = [];
    isProcessingHistogram.value = false;
  };

  /**
   * Resets histogram with error state
   * 
   * @param errorMsg Error message to display
   * @param errorCode Error code
   */
  const resetHistogramWithError = (errorMsg: string, errorCode: number = 1): void => {
    searchObj.value.data.histogram = {
      xData: [],
      yData: [],
      chartParams: {
        title: '',
        unparsed_x_data: [],
        timezone: timezone.value,
      },
      errorCode,
      errorMsg,
      errorDetail: '',
    };

    histogramError.value = errorMsg;
  };

  // ========================================
  // UTILITY FUNCTIONS
  // ========================================

  /**
   * Determines if histogram is eligible for current query
   * 
   * @param parsedSQL Parsed SQL object
   * @returns True if histogram is eligible
   */
  const isHistogramEligible = (parsedSQL: any = null): boolean => {
    // Don't show histogram for aggregated queries
    if (parsedSQL && hasAggregation(parsedSQL.columns)) {
      return false;
    }

    // Don't show histogram for DISTINCT queries
    if (parsedSQL && parsedSQL.distinct?.type === 'DISTINCT') {
      return false;
    }

    // Don't show histogram if explicitly disabled
    if (!searchObj.value.meta.showHistogram) {
      return false;
    }

    return true;
  };

  /**
   * Checks if query columns contain aggregation functions
   */
  const hasAggregation = (columns: any[]): boolean => {
    if (!columns || !Array.isArray(columns)) return false;

    return columns.some(column => 
      column.expr && column.expr.type === 'aggr_func'
    );
  };

  /**
   * Gets available histogram intervals
   */
  const getAvailableIntervals = (): string[] => {
    return [
      '1 second',
      '5 seconds',
      '10 seconds',
      '30 seconds',
      '1 minute',
      '5 minutes',
      '10 minutes',
      '30 minutes',
      '1 hour',
      '2 hours',
      '6 hours',
      '12 hours',
      '1 day',
    ];
  };

  /**
   * Gets available key formats for histogram display
   */
  const getAvailableKeyFormats = (): { label: string; value: string }[] => {
    return [
      { label: 'HH:mm:ss', value: 'HH:mm:ss' },
      { label: 'HH:mm', value: 'HH:mm' },
      { label: 'MM-DD HH:mm', value: 'MM-DD HH:mm' },
      { label: 'YYYY-MM-DD HH:mm', value: 'YYYY-MM-DD HH:mm' },
      { label: 'YYYY-MM-DD HH:mm:ss', value: 'YYYY-MM-DD HH:mm:ss' },
    ];
  };

  // ========================================
  // RETURN INTERFACE
  // ========================================

  return {
    // Computed State
    histogramData,
    isHistogramEnabled,
    hasHistogramData,
    hasHistogramError,
    currentInterval,
    currentKeyFormat,
    timezone,

    // Configuration
    histogramConfig,
    updateHistogramConfig,

    // Data Processing
    generateHistogramData,
    formatHistogramTimestamp,
    getHistogramTitle,

    // Query Building
    buildHistogramQuery,
    buildHistogramSQLQuery,
    buildMultiStreamHistogramQuery,

    // Skeleton Data
    generateHistogramSkeleton,
    histogramSkeletonData,

    // Reset Functions
    resetHistogramData,
    resetHistogramWithError,

    // Utility Functions
    isHistogramEligible,
    parseIntervalToMilliseconds,
    getAvailableIntervals,
    getAvailableKeyFormats,

    // State Management
    isProcessingHistogram,
    histogramError,
    chartParams,
  };
}
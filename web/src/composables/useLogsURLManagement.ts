/**
 * useLogsURLManagement.ts
 * 
 * Manages URL parameters, routing, and state persistence for the logs module.
 * Handles URL generation, parameter extraction, and state synchronization
 * between the application state and browser URL.
 */

import { ref, type Ref } from 'vue';
import { useRouter } from 'vue-router';
import { useStore } from 'vuex';
import {
  b64EncodeUnicode,
  b64DecodeUnicode,
  useLocalTimezone
} from '@/utils/zincutils';
import type { 
  UseLogsURLManagement,
  SearchObject
} from './INTERFACES_AND_TYPES';

/**
 * URL Management Composable
 * 
 * Provides URL parameter management functionality including:
 * - URL query generation from application state
 * - State restoration from URL parameters
 * - Visualization config encoding/decoding
 * - Route management and navigation
 */
export default function useLogsURLManagement(
  searchObj: Ref<SearchObject>
): UseLogsURLManagement {
  const router = useRouter();
  const store = useStore();

  // ========================================
  // REACTIVE STATE
  // ========================================

  const urlParams = ref<any>({});
  const routeState = ref<any>({});

  // ========================================
  // VISUALIZATION CONFIG UTILITIES
  // ========================================

  /**
   * Extracts visualization configuration from dashboard panel data
   * 
   * @param dashboardPanelData Dashboard panel configuration object
   * @returns Extracted configuration or null
   */
  const getVisualizationConfig = (dashboardPanelData: any): any => {
    if (!dashboardPanelData?.data) {
      return null;
    }
    return dashboardPanelData.data;
  };

  /**
   * Encodes visualization configuration to base64 string for URL storage
   * 
   * @param config Configuration object to encode
   * @returns Base64 encoded string or null if encoding fails
   */
  const encodeVisualizationConfig = (config: any): string | null => {
    try {
      return b64EncodeUnicode(JSON.stringify(config));
    } catch (error) {
      console.error("Failed to encode visualization config:", error);
      return null;
    }
  };

  /**
   * Decodes base64 visualization configuration from URL
   * 
   * @param encodedConfig Base64 encoded configuration string
   * @returns Decoded configuration object or null if decoding fails
   */
  const decodeVisualizationConfig = (encodedConfig: string): any => {
    try {
      return JSON.parse(b64DecodeUnicode(encodedConfig) ?? "{}");
    } catch (error) {
      console.error("Failed to decode visualization config:", error);
      return null;
    }
  };

  // ========================================
  // URL GENERATION
  // ========================================

  /**
   * Generates URL query parameters from current application state
   * 
   * @param isShareLink Whether this is for a shareable link (affects date handling)
   * @param dashboardPanelData Dashboard panel data for visualization mode
   * @returns Object containing URL query parameters
   */
  const generateURLQuery = (isShareLink: boolean = false, dashboardPanelData: any = null): any => {
    const date = searchObj.value.data.datetime;
    const query: any = {};

    // Stream type
    if (searchObj.value.data.stream.streamType) {
      query["stream_type"] = searchObj.value.data.stream.streamType;
    }

    // Selected streams
    if (searchObj.value.data.stream.selectedStream.length > 0) {
      if (typeof searchObj.value.data.stream.selectedStream !== "object") {
        query["stream"] = searchObj.value.data.stream.selectedStream.join(",");
      } else if (
        typeof searchObj.value.data.stream.selectedStream === "object" &&
        searchObj.value.data.stream.selectedStream.hasOwnProperty("value")
      ) {
        query["stream"] = (searchObj.value.data.stream.selectedStream as any).value;
      } else {
        query["stream"] = searchObj.value.data.stream.selectedStream.join(",");
      }
    }

    // Date/time parameters
    if (date.type === "relative") {
      if (isShareLink) {
        // For share links, use absolute timestamps
        query["from"] = date.startTime;
        query["to"] = date.endTime;
      } else {
        // For regular URLs, use relative period
        query["period"] = date.relativeTimePeriod;
      }
    } else if (date.type === "absolute") {
      query["from"] = date.startTime;
      query["to"] = date.endTime;
    }

    // Refresh interval
    query["refresh"] = searchObj.value.meta.refreshInterval;

    // Query and SQL mode
    if (searchObj.value.data.query) {
      query["sql_mode"] = searchObj.value.meta.sqlMode;
      query["query"] = b64EncodeUnicode(searchObj.value.data.query.trim());
    }

    // Function content
    if (
      searchObj.value.data.transformType === "function" &&
      searchObj.value.data.tempFunctionContent !== ""
    ) {
      query["functionContent"] = b64EncodeUnicode(
        searchObj.value.data.tempFunctionContent.trim()
      );
    }

    // Page type
    if (searchObj.value.meta.pageType !== "logs") {
      query["type"] = searchObj.value.meta.pageType;
    }

    // Various settings
    query["defined_schemas"] = searchObj.value.meta.useUserDefinedSchemas;
    query["org_identifier"] = store.state.selectedOrganization.identifier;
    query["quick_mode"] = searchObj.value.meta.quickMode;
    query["show_histogram"] = searchObj.value.meta.showHistogram;

    // Super cluster settings
    if (store.state.zoConfig?.super_cluster_enabled && searchObj.value.meta?.regions?.length) {
      query["regions"] = searchObj.value.meta.regions.join(",");
    }

    if (store.state.zoConfig?.super_cluster_enabled && searchObj.value.meta?.clusters?.length) {
      query["clusters"] = searchObj.value.meta.clusters.join(",");
    }

    // Logs visualize toggle
    if (searchObj.value.meta.logsVisualizeToggle) {
      query["logs_visualize_toggle"] = searchObj.value.meta.logsVisualizeToggle;
    }

    // Visualization data for visualize mode
    if (searchObj.value.meta.logsVisualizeToggle === "visualize" && dashboardPanelData) {
      const visualizationConfig = getVisualizationConfig(dashboardPanelData);
      if (visualizationConfig) {
        const encodedConfig = encodeVisualizationConfig(visualizationConfig);
        if (encodedConfig) {
          query["visualization_data"] = encodedConfig;
        }
      }
    }

    return query;
  };

  /**
   * Updates the browser URL with current application state
   * 
   * @param dashboardPanelData Dashboard panel data for visualization mode
   */
  const updateUrlQueryParams = (dashboardPanelData: any = null): void => {
    const query = generateURLQuery(false, dashboardPanelData);
    
    // Clean up specific query types that shouldn't persist
    if (
      (Object.hasOwn(query, "type") &&
        query.type === "search_history_re_apply") ||
      query.type === "search_scheduler"
    ) {
      delete query.type;
    }

    urlParams.value = query;
    router.push({ query });
  };

  // ========================================
  // URL RESTORATION
  // ========================================

  /**
   * Restores application state from URL query parameters
   * 
   * @param dashboardPanelData Dashboard panel data for visualization mode
   */
  const restoreUrlQueryParams = async (dashboardPanelData: any = null): Promise<void> => {
    // Add null checking to prevent errors during initialization
    if (!searchObj.value) {
      console.warn("SearchObj not initialized yet, skipping URL parameter restoration");
      return;
    }

    searchObj.value.shouldIgnoreWatcher = true;
    const queryParams: any = router.currentRoute.value.query;
    
    if (!queryParams.stream) {
      searchObj.value.shouldIgnoreWatcher = false;
      return;
    }

    // Set organization identifier
    if (queryParams.org_identifier) {
      searchObj.value.organizationIdentifier = queryParams.org_identifier;
    }

    // Restore date/time settings
    const date = {
      startTime: Number(queryParams.from),
      endTime: Number(queryParams.to),
      relativeTimePeriod: queryParams.period || null,
      type: queryParams.period ? "relative" : "absolute",
    };

    if (date.type === "relative") {
      queryParams.period = date.relativeTimePeriod;
    } else {
      queryParams.from = date.startTime;
      queryParams.to = date.endTime;
    }

    if (date) {
      searchObj.value.data.datetime = date;
    }

    // Restore query and SQL mode
    if (queryParams.query) {
      searchObj.value.meta.sqlMode = queryParams.sql_mode === "true";
      searchObj.value.data.editorValue = b64DecodeUnicode(queryParams.query);
      searchObj.value.data.query = b64DecodeUnicode(queryParams.query);
    }

    // Restore schema settings
    if (
      queryParams.hasOwnProperty("defined_schemas") &&
      queryParams.defined_schemas !== ""
    ) {
      searchObj.value.meta.useUserDefinedSchemas = queryParams.defined_schemas;
    }

    // Restore refresh interval
    if (queryParams.refresh && enableRefreshInterval(parseInt(queryParams.refresh))) {
      searchObj.value.meta.refreshInterval = parseInt(queryParams.refresh);
    }

    if (queryParams.refresh && !enableRefreshInterval(parseInt(queryParams.refresh))) {
      delete queryParams.refresh;
    }

    // Set timezone
    useLocalTimezone(queryParams.timezone);

    // Restore function content
    if (queryParams.functionContent) {
      searchObj.value.data.tempFunctionContent =
        b64DecodeUnicode(queryParams.functionContent) || "";
      searchObj.value.meta.functionEditorPlaceholderFlag = false;
      searchObj.value.data.transformType = "function";
    }

    // Restore stream settings
    if (queryParams.stream_type) {
      searchObj.value.data.stream.streamType = queryParams.stream_type;
    } else {
      searchObj.value.data.stream.streamType = "logs";
    }

    // Restore page type
    if (queryParams.type) {
      searchObj.value.meta.pageType = queryParams.type;
    }

    // Restore quick mode
    searchObj.value.meta.quickMode = queryParams.quick_mode !== "false";

    // Restore selected streams
    if (queryParams.stream) {
      searchObj.value.data.stream.selectedStream = queryParams.stream.split(",");
    }

    // Restore histogram setting
    if (queryParams.show_histogram) {
      searchObj.value.meta.showHistogram = queryParams.show_histogram === "true";
    }

    // Restore super cluster settings
    if (store.state.zoConfig?.super_cluster_enabled && queryParams.regions) {
      searchObj.value.meta.regions = queryParams.regions.split(",");
    }

    if (store.state.zoConfig?.super_cluster_enabled && queryParams.clusters) {
      searchObj.value.meta.clusters = queryParams.clusters.split(",");
    }

    // Restore logs visualize toggle
    if (queryParams.hasOwnProperty("logs_visualize_toggle") && queryParams.logs_visualize_toggle !== "") {
      searchObj.value.meta.logsVisualizeToggle = queryParams.logs_visualize_toggle;
    }

    // Restore visualization data if available and in visualize mode
    if (
      queryParams.visualization_data &&
      searchObj.value.meta.logsVisualizeToggle === "visualize" &&
      dashboardPanelData
    ) {
      const restoredData = decodeVisualizationConfig(queryParams.visualization_data);
      if (restoredData && dashboardPanelData.data) {
        dashboardPanelData.data = {
          ...dashboardPanelData.data,
          ...restoredData,
        };
      }
    }

    searchObj.value.shouldIgnoreWatcher = false;

    // Clean up search history re-apply type
    if (
      Object.hasOwn(queryParams, "type") &&
      queryParams.type === "search_history_re_apply"
    ) {
      delete queryParams.type;
    }

    // Update URL with clean parameters
    router.push({
      query: {
        ...queryParams,
        sql_mode: searchObj.value.meta.sqlMode,
        defined_schemas: searchObj.value.meta.useUserDefinedSchemas,
      },
    });

    routeState.value = { ...queryParams };
  };

  // ========================================
  // UTILITY FUNCTIONS
  // ========================================

  /**
   * Checks if the given refresh interval is allowed
   * 
   * @param value Refresh interval in seconds
   * @returns True if interval is allowed
   */
  const enableRefreshInterval = (value: number): boolean => {
    return value >= (Number(store.state?.zoConfig?.min_auto_refresh_interval) || 0);
  };

  /**
   * Extracts timestamps from a relative time period string
   * 
   * @param period Time period string (e.g., "15m", "1h", "1d")
   * @returns Object with from and to timestamps
   */
  const extractTimestamps = (period: string): { from: number; to: number } => {
    const currentTime = new Date();
    let fromTimestamp: number;
    let toTimestamp: number;

    switch (period.slice(-1)) {
      case "s":
        fromTimestamp = currentTime.getTime() - parseInt(period) * 1000;
        toTimestamp = currentTime.getTime();
        break;
      case "m":
        fromTimestamp = currentTime.getTime() - parseInt(period) * 60 * 1000;
        toTimestamp = currentTime.getTime();
        break;
      case "h":
        fromTimestamp = currentTime.getTime() - parseInt(period) * 60 * 60 * 1000;
        toTimestamp = currentTime.getTime();
        break;
      case "d":
        fromTimestamp = currentTime.getTime() - parseInt(period) * 24 * 60 * 60 * 1000;
        toTimestamp = currentTime.getTime();
        break;
      case "w":
        fromTimestamp = currentTime.getTime() - parseInt(period) * 7 * 24 * 60 * 60 * 1000;
        toTimestamp = currentTime.getTime();
        break;
      case "M":
        fromTimestamp = currentTime.getTime() - parseInt(period) * 30 * 24 * 60 * 60 * 1000;
        toTimestamp = currentTime.getTime();
        break;
      case "y":
        fromTimestamp = currentTime.getTime() - parseInt(period) * 365 * 24 * 60 * 60 * 1000;
        toTimestamp = currentTime.getTime();
        break;
      default:
        // Default to 15 minutes if format is not recognized
        fromTimestamp = currentTime.getTime() - 15 * 60 * 1000;
        toTimestamp = currentTime.getTime();
        break;
    }

    return { 
      from: fromTimestamp * 1000, // Convert to microseconds
      to: toTimestamp * 1000 
    };
  };

  /**
   * Sets the date/time range based on a period string
   * 
   * @param period Time period string (default: "15m")
   */
  const setDateTime = (period: string = "15m"): void => {
    const extractedDate = extractTimestamps(period);
    searchObj.value.data.datetime.startTime = extractedDate.from;
    searchObj.value.data.datetime.endTime = extractedDate.to;
  };

  // ========================================
  // NAVIGATION FUNCTIONS
  // ========================================

  /**
   * Navigates to the search scheduler page
   */
  const routeToSearchSchedule = (): void => {
    router.push({
      name: "search_scheduler",
      query: {
        ...router.currentRoute.value.query,
        type: "search_scheduler"
      }
    });
  };

  // ========================================
  // RETURN INTERFACE
  // ========================================

  return {
    // State
    urlParams,
    routeState,
    
    // URL Operations
    generateURLQuery,
    updateUrlQueryParams,
    restoreUrlQueryParams,
    
    // Configuration Encoding
    getVisualizationConfig,
    encodeVisualizationConfig,
    decodeVisualizationConfig,
    
    // Navigation
    routeToSearchSchedule,
    extractTimestamps,
    setDateTime,
  };
}
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
import { useLogsState } from "@/composables/useLogsState";
import { b64EncodeUnicode, b64DecodeUnicode, useLocalTimezone } from "@/utils/zincutils";
import {
  generateURLQuery as generateURLQueryUtil,
  encodeVisualizationConfig,
  type URLQueryParams
} from "@/utils/logs/transformers";
import {
  extractValueQuery,
  type ValueQueryParams
} from "@/utils/logs/parsers";
import {
  createSQLParserFunctions
} from "@/utils/logs/parsers";

interface VisualizationConfig {
  config: any;
  type: string;
}

/**
 * URL management composable for logs functionality
 * Contains all URL parameter generation, restoration, and routing operations
 */
export const useLogsURL = () => {
  const store = useStore();
  const router = useRouter();
  const { searchObj } = useLogsState();

  // SQL Parser functions (using mock parser for consistency with other composables)
  const mockParser = {};
  const { parseSQL: fnParsedSQL, unparseSQL: fnUnparsedSQL } = createSQLParserFunctions(mockParser);

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
   * Generate URL query parameters from current search state
   */
  const generateURLQuery = (isShareLink: boolean = false, dashboardPanelData: any = null): Record<string, any> => {
    try {
      // Convert local state to the extracted utility's parameter format
      const params: URLQueryParams = {
        isShareLink,
        dashboardPanelData,
        streamType: searchObj.data.stream.streamType,
        selectedStream: searchObj.data.stream.selectedStream,
        datetime: {
          startTime: isShareLink && searchObj.data.datetime.type === "relative" 
            ? searchObj.data.datetime.startTime 
            : searchObj.data.datetime.startTime,
          endTime: isShareLink && searchObj.data.datetime.type === "relative"
            ? searchObj.data.datetime.endTime
            : searchObj.data.datetime.endTime,
          type: searchObj.data.datetime.type,
          relativeTimePeriod: searchObj.data.datetime.relativeTimePeriod
        },
        query: searchObj.data.query?.trim() || "",
        sqlMode: searchObj.meta.sqlMode,
        showTransformEditor: searchObj.meta.showTransformEditor,
        selectedFields: searchObj.meta.useUserDefinedSchemas,
        refreshInterval: searchObj.meta.refreshInterval,
        resultGrid: {
          showPagination: true,
          rowsPerPage: searchObj.meta.resultGrid.rowsPerPage,
          currentPage: searchObj.data.resultGrid.currentPage
        },
        meta: {
          showHistogram: searchObj.meta.showHistogram,
          showDetailTab: true,
          resultGrid: {
            chartInterval: "auto"
          }
        }
      };

      // Use the extracted utility and then add custom properties not covered by it
      const query = generateURLQueryUtil(params);
      
      // Add properties specific to this implementation that the utility doesn't handle
      if (searchObj.data.transformType === "function" && searchObj.data.tempFunctionContent != "") {
        query["functionContent"] = b64EncodeUnicode(searchObj.data.tempFunctionContent.trim());
      }
      
      if (searchObj.meta.pageType !== "logs") {
        query["type"] = searchObj.meta.pageType;
      }
      
      query["org_identifier"] = store.state.selectedOrganization.identifier;
      query["quick_mode"] = searchObj.meta.quickMode;
      
      if (store.state.zoConfig?.super_cluster_enabled && searchObj.meta?.regions?.length) {
        query["regions"] = searchObj.meta.regions.join(",");
      }
      
      if (store.state.zoConfig?.super_cluster_enabled && searchObj.meta?.clusters?.length) {
        query["clusters"] = searchObj.meta.clusters.join(",");
      }
      
      if (searchObj.meta.logsVisualizeToggle) {
        query["logs_visualize_toggle"] = searchObj.meta.logsVisualizeToggle;
      }
      
      // Preserve visualization data in URL
      if (searchObj.meta.logsVisualizeToggle === "visualize" && dashboardPanelData) {
        const visualizationData = getVisualizationConfig(dashboardPanelData);
        if (visualizationData) {
          const encoded = encodeVisualizationConfig(visualizationData);
          if (encoded) {
            query["visualization_data"] = encoded;
          }
        }
      } else {
        const existingEncodedConfig = router.currentRoute.value?.query?.visualization_data as string | undefined;
        if (existingEncodedConfig) {
          query["visualization_data"] = existingEncodedConfig;
        }
      }
      
      return query;
    } catch (error: any) {
      console.error("Error generating URL query:", error);
      return {};
    }
  };

  /**
   * Update URL query parameters with current search state
   */
  const updateUrlQueryParams = (dashboardPanelData: any = null) => {
    try {
      const query = generateURLQuery(false, dashboardPanelData);
      if (
        (Object.hasOwn(query, "type") &&
          query.type == "search_history_re_apply") ||
        query.type == "search_scheduler"
      ) {
        delete query.type;
      }
      router.push({ query });
    } catch (error: any) {
      console.error("Error updating URL query params:", error);
    }
  };

  /**
   * Check if refresh interval is enabled for the given value
   */
  const enableRefreshInterval = (value: number): boolean => {
    try {
      return (
        value >= (Number(store.state?.zoConfig?.min_auto_refresh_interval) || 0)
      );
    } catch (error: any) {
      console.error("Error checking refresh interval:", error);
      return false;
    }
  };

  /**
   * Restore search state from URL query parameters
   */
  const restoreUrlQueryParams = async (dashboardPanelData: any = null) => {
    try {
      searchObj.shouldIgnoreWatcher = true;
      const queryParams: any = router.currentRoute.value.query;
      
      if (!queryParams.stream) {
        searchObj.shouldIgnoreWatcher = false;
        return;
      }

      // Restore date/time parameters
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
        searchObj.data.datetime = date;
      }

      // Restore query and SQL mode
      if (queryParams.query) {
        searchObj.meta.sqlMode = queryParams.sql_mode == "true" ? true : false;
        searchObj.data.editorValue = b64DecodeUnicode(queryParams.query);
        searchObj.data.query = b64DecodeUnicode(queryParams.query);
      }

      // Restore defined schemas
      if (
        queryParams.hasOwnProperty("defined_schemas") &&
        queryParams.defined_schemas != ""
      ) {
        searchObj.meta.useUserDefinedSchemas = queryParams.defined_schemas;
      }

      // Restore refresh interval
      if (
        queryParams.refresh &&
        enableRefreshInterval(parseInt(queryParams.refresh))
      ) {
        searchObj.meta.refreshInterval = parseInt(queryParams.refresh);
      }

      if (
        queryParams.refresh &&
        !enableRefreshInterval(parseInt(queryParams.refresh))
      ) {
        delete queryParams.refresh;
      }

      // Use timezone
      useLocalTimezone(queryParams.timezone);

      // Restore function content
      if (queryParams.functionContent) {
        searchObj.data.tempFunctionContent =
          b64DecodeUnicode(queryParams.functionContent) || "";
        searchObj.meta.functionEditorPlaceholderFlag = false;
        searchObj.data.transformType = "function";
      }

      // Restore stream type
      if (queryParams.stream_type) {
        searchObj.data.stream.streamType = queryParams.stream_type;
      } else {
        searchObj.data.stream.streamType = "logs";
      }

      // Restore page type
      if (queryParams.type) {
        searchObj.meta.pageType = queryParams.type;
      }
      
      searchObj.meta.quickMode = queryParams.quick_mode == "false" ? false : true;

      // Restore selected streams
      if (queryParams.stream) {
        searchObj.data.stream.selectedStream = queryParams.stream.split(",");
      }

      // Restore histogram visibility
      if (queryParams.show_histogram) {
        searchObj.meta.showHistogram =
          queryParams.show_histogram == "true" ? true : false;
      }

      searchObj.shouldIgnoreWatcher = false;
      
      // Clean up search history re-apply type
      if (
        Object.hasOwn(queryParams, "type") &&
        queryParams.type == "search_history_re_apply"
      ) {
        delete queryParams.type;
      }

      // Restore super cluster settings
      if (store.state.zoConfig?.super_cluster_enabled && queryParams.regions) {
        searchObj.meta.regions = queryParams.regions.split(",");
      }

      if (store.state.zoConfig?.super_cluster_enabled && queryParams.clusters) {
        searchObj.meta.clusters = queryParams.clusters.split(",");
      }

      // Restore logs visualize toggle
      if (queryParams.hasOwnProperty("logs_visualize_toggle") && queryParams.logs_visualize_toggle != "") {
        searchObj.meta.logsVisualizeToggle = queryParams.logs_visualize_toggle;
      }

      // Restore function editor state
      if (queryParams.fn_editor) {
        searchObj.meta.showTransformEditor = queryParams.fn_editor == "true" ? true : false;
      }

      // TODO OK : Replace push with replace and test all scenarios
      router.push({
        query: {
          ...queryParams,
          sql_mode: searchObj.meta.sqlMode,
          defined_schemas: searchObj.meta.useUserDefinedSchemas,
        },
      });
    } catch (error: any) {
      console.error("Error restoring URL query params:", error);
      searchObj.shouldIgnoreWatcher = false;
    }
  };

  /**
   * Route to search schedule page
   */
  const routeToSearchSchedule = () => {
    try {
      router.push({
        query: {
          action: "search_scheduler",
          org_identifier: store.state.selectedOrganization.identifier,
          type: "search_scheduler_list",
        },
      });
    } catch (error: any) {
      console.error("Error routing to search schedule:", error);
    }
  };

  /**
   * Extract value query from current search state
   */
  const extractValueQueryLocal = (): Record<string, string> => {
    try {
      const params: ValueQueryParams = {
        sqlMode: searchObj.meta.sqlMode,
        query: searchObj.data.query,
        selectedStreams: searchObj.data.stream.selectedStream,
        parseSQL: fnParsedSQL,
        unparseSQL: fnUnparsedSQL
      };
      return extractValueQuery(params);
    } catch (error: any) {
      console.error("Error extracting value query locally:", error);
      return {};
    }
  };

  /**
   * Get current URL query parameters as an object
   */
  const getCurrentUrlParams = (): Record<string, any> => {
    try {
      return router.currentRoute.value.query || {};
    } catch (error: any) {
      console.error("Error getting current URL params:", error);
      return {};
    }
  };

  /**
   * Check if URL has specific parameter
   */
  const hasUrlParam = (paramName: string): boolean => {
    try {
      const params = getCurrentUrlParams();
      return params.hasOwnProperty(paramName);
    } catch (error: any) {
      console.error("Error checking URL param:", error);
      return false;
    }
  };

  /**
   * Get specific URL parameter value
   */
  const getUrlParam = (paramName: string): string | null => {
    try {
      const params = getCurrentUrlParams();
      return params[paramName] as string || null;
    } catch (error: any) {
      console.error("Error getting URL param:", error);
      return null;
    }
  };

  /**
   * Update specific URL parameter without affecting others
   */
  const updateUrlParam = (paramName: string, value: any) => {
    try {
      const currentQuery = getCurrentUrlParams();
      const newQuery = { ...currentQuery };
      
      if (value === null || value === undefined) {
        delete newQuery[paramName];
      } else {
        newQuery[paramName] = value;
      }
      
      router.push({ query: newQuery });
    } catch (error: any) {
      console.error("Error updating URL param:", error);
    }
  };

  /**
   * Clear all URL parameters
   */
  const clearUrlParams = () => {
    try {
      router.push({ query: {} });
    } catch (error: any) {
      console.error("Error clearing URL params:", error);
    }
  };

  /**
   * Check if current route matches specific patterns
   */
  const isRouteType = (type: string): boolean => {
    try {
      const params = getCurrentUrlParams();
      return params.type === type;
    } catch (error: any) {
      console.error("Error checking route type:", error);
      return false;
    }
  };

  /**
   * Generate shareable URL for current search state
   */
  const generateShareableUrl = (dashboardPanelData: any = null): string => {
    try {
      const baseUrl = window.location.origin + window.location.pathname;
      const queryParams = generateURLQuery(true, dashboardPanelData);
      const searchParams = new URLSearchParams(queryParams);
      return `${baseUrl}?${searchParams.toString()}`;
    } catch (error: any) {
      console.error("Error generating shareable URL:", error);
      return window.location?.href || "";
    }
  };

  /**
   * Navigate to a specific search configuration
   */
  const navigateToSearch = (config: {
    query?: string;
    streams?: string[];
    timeRange?: { start: string; end: string; period?: string };
    sqlMode?: boolean;
  }) => {
    try {
      const currentQuery = getCurrentUrlParams();
      const newQuery = { ...currentQuery };

      if (config.query !== undefined) {
        newQuery.query = b64EncodeUnicode(config.query);
      }

      if (config.streams) {
        newQuery.stream = config.streams.join(",");
      }

      if (config.timeRange) {
        if (config.timeRange.period) {
          newQuery.period = config.timeRange.period;
          delete newQuery.from;
          delete newQuery.to;
        } else {
          newQuery.from = config.timeRange.start;
          newQuery.to = config.timeRange.end;
          delete newQuery.period;
        }
      }

      if (config.sqlMode !== undefined) {
        newQuery.sql_mode = config.sqlMode.toString();
      }

      router.push({ query: newQuery });
    } catch (error: any) {
      console.error("Error navigating to search:", error);
    }
  };

  return {
    // Core URL operations
    generateURLQuery,
    updateUrlQueryParams,
    restoreUrlQueryParams,
    
    // Routing operations
    routeToSearchSchedule,
    navigateToSearch,
    
    // Query extraction
    extractValueQueryLocal,
    
    // URL parameter utilities
    getCurrentUrlParams,
    hasUrlParam,
    getUrlParam,
    updateUrlParam,
    clearUrlParams,
    
    // Route checking
    isRouteType,
    
    // Sharing utilities
    generateShareableUrl,
    
    // Configuration utilities
    getVisualizationConfig,
    enableRefreshInterval,
  };
};

export default useLogsURL;
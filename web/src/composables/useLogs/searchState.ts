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

import { reactive, ref, type Ref, nextTick } from "vue";
import { useStore } from "vuex";
import type { SearchRequestPayload } from "@/ts/interfaces";
import {
  DEFAULT_LOGS_CONFIG,
  DEFAULT_SEARCH_DEBUG_DATA,
  DEFAULT_SEARCH_AGG_DATA,
} from "@/utils/logs/constants";

interface HistogramData {
  xData: any[];
  yData: any[];
  chartParams: {
    title: string;
    unparsed_x_data: any[];
    timezone: string;
  };
  errorMsg: string;
  errorCode: number;
  errorDetail: string;
}

interface SearchObjectData {
  errorMsg: string;
  stream: {
    streamLists: any[];
    selectedStream: string[];
    selectedStreamFields: any[];
  };
  queryResults: any;
  sortedQueryResults: any[];
  histogram: HistogramData;
  tempFunctionContent: string;
  query: string;
  editorValue: string;
  savedViews: any[];
}

interface SearchObject {
  organizationIdentifier: string;
  config: any;
  communicationMethod: string;
  meta: any;
  data: SearchObjectData;
  runQuery: boolean;
}

/**
 * Reactive state management for logs functionality
 * Contains all reactive state variables used across logs components
 */
export const searchState = () => {
  const store = useStore();

  // Main search object containing all search state
  const searchObj = reactive(
    Object.assign({}, DEFAULT_LOGS_CONFIG),
  ) as SearchObject;

  // Debug data for search operations
  const searchObjDebug = reactive(Object.assign({}, DEFAULT_SEARCH_DEBUG_DATA));

  // Aggregation data for search results
  const searchAggData = reactive(Object.assign({}, DEFAULT_SEARCH_AGG_DATA));

  // Initial query payload reference
  const initialQueryPayload: Ref<SearchRequestPayload | null> = ref(null);

  // Field schema index mapping
  const streamSchemaFieldsIndexMapping = ref<{ [key: string]: number }>({});

  // Field values reference
  const fieldValues = ref();

  // Notification message reference
  const notificationMsg = ref("");

  // FTS (Full Text Search) fields
  const ftsFields: any = ref([]);

  /**
   * Initializes the logs state from cached store data.
   *
   * This function restores the search object state from the Vuex store cache,
   * including organization identifier, configuration, meta data, and search results.
   * It performs deep cloning to prevent reference issues and resets specific properties
   * like refresh interval and query results to ensure clean state initialization.
   *
   * @returns Promise that resolves to true when initialization is complete
   *
   * @example
   * ```typescript
   * await initialLogsState();
   * // Search state is now initialized from store cache
   * ```
   */
  const initialLogsState = async (): Promise<boolean | undefined> => {
    if (!store.state.logs.isInitialized) {
      return undefined;
    }

    try {
      const state = store.getters["logs/getLogs"];

      // Initialize basic properties
      searchObj.organizationIdentifier = state.organizationIdentifier;
      searchObj.config = JSON.parse(JSON.stringify(state.config));
      searchObj.communicationMethod = state.communicationMethod;

      await nextTick();

      // Initialize meta with reset refresh interval
      searchObj.meta = JSON.parse(
        JSON.stringify({
          ...state.meta,
          refreshInterval: 0,
        }),
      );

      // Initialize data with default histogram structure
      searchObj.data = JSON.parse(
        JSON.stringify({
          ...JSON.parse(JSON.stringify(state.data)),
          queryResults: {},
          sortedQueryResults: [],
          histogram: {
            xData: [],
            yData: [],
            chartParams: {
              title: "",
              unparsed_x_data: [],
              timezone: "",
            },
            errorMsg: "",
            errorCode: 0,
            errorDetail: "",
          },
        }),
      );

      await nextTick();

      // Restore cached query results and histogram data
      searchObj.data.queryResults = JSON.parse(
        JSON.stringify(state.data.queryResults),
      );
      searchObj.data.sortedQueryResults = JSON.parse(
        JSON.stringify(state.data.sortedQueryResults),
      );
      searchObj.data.histogram = JSON.parse(
        JSON.stringify(state.data.histogram),
      );

      await nextTick();
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error("Error while initializing logs state:", errorMessage);

      // Fallback to current organization and reset state
      searchObj.organizationIdentifier =
        store.state?.selectedOrganization?.identifier || "";
      resetSearchObj();
    } finally {
      // eslint-disable-next-line no-unsafe-finally
      return Promise.resolve(true);
    }
  };

  /**
   * Resets the search object to its default state.
   *
   * This function clears all search-related data including streams, query results,
   * histogram data, queries, and various search configurations. It's typically used
   * when switching organizations, handling errors, or performing a complete reset
   * of the search interface.
   *
   * @example
   * ```typescript
   * resetSearchObj();
   * // Search object is now reset to default state
   * ```
   */
  const resetSearchObj = (): void => {
    // Reset error message and stream data
    searchObj.data.errorMsg = "No stream found in selected organization!";
    searchObj.data.stream.streamLists = [];
    searchObj.data.stream.selectedStream = [];
    searchObj.data.stream.selectedStreamFields = [];

    // Clear query results
    searchObj.data.queryResults = {};
    searchObj.data.sortedQueryResults = [];

    // Reset histogram to default state
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

    // Clear query and editor content
    searchObj.data.tempFunctionContent = "";
    searchObj.data.query = "";
    searchObj.data.editorValue = "";

    // Reset search configuration
    searchObj.meta.sqlMode = false;
    searchObj.runQuery = false;
    searchObj.data.savedViews = [];
  };

  return {
    // Reactive state
    searchObj,
    searchObjDebug,
    searchAggData,
    initialQueryPayload,
    streamSchemaFieldsIndexMapping,
    fieldValues,
    notificationMsg,
    ftsFields,
    resetSearchObj,
    initialLogsState,
  };
};

export default searchState;

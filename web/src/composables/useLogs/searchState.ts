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
import { useRouter } from "vue-router";
// import { useI18n } from "vue-i18n";
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

interface StreamData {
  streamLists: any[];
  selectedStream: string[];
  selectedStreamFields: any[];
  selectedFields: any[];
  filterField: string;
  addToFilter: string;
  functions: any[];
  streamType: string;
}

interface ResultGrid {
  currentPage: number;
}

interface SearchAroundData {
  indexTimestamp: number;
  size: number;
}

interface SearchObjectData {
  streamResults: any;
  errorMsg: string;
  errorDetail: string;
  countErrorMsg: string;
  stream: StreamData;
  queryResults: any;
  sortedQueryResults: any[];
  histogram: HistogramData;
  tempFunctionContent: string;
  query: string;
  editorValue: string;
  savedViews: any[];
  transforms: any[];
  resultGrid: ResultGrid;
  searchAround: SearchAroundData;
  highlightQuery: string;
}

interface SearchObject {
  organizationIdentifier: string;
  config: any;
  communicationMethod: string;
  meta: any;
  data: SearchObjectData;
  runQuery: boolean;
}

// Main search object containing all search state
const searchObj = reactive(
  Object.assign({}, DEFAULT_LOGS_CONFIG),
) as SearchObject;

// Debug data for search operations
const searchObjDebug = reactive(Object.assign({}, DEFAULT_SEARCH_DEBUG_DATA));

// Aggregation data for search results
const searchAggData = reactive(Object.assign({}, DEFAULT_SEARCH_AGG_DATA));

type SearchPartition = {
  partition: number;
  chunks: Record<number, number>;
};

const searchPartitionMap = reactive<Record<string, SearchPartition>>({});

const histogramMappedData: any = [];

const histogramResults: any = ref([]);

const initialQueryPayload: Ref<SearchRequestPayload | null> = ref(null);

// Field schema index mapping
const streamSchemaFieldsIndexMapping = ref<{ [key: string]: number }>({});

/**
 * Reactive state management for logs functionality
 * Contains all reactive state variables used across logs components
 */
export const searchState = () => {
  const store = useStore();
  const router = useRouter();
  // const { t } = useI18n();

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
      return true;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error("Error while initializing logs state:", errorMessage);

      // Fallback to current organization and reset state
      searchObj.organizationIdentifier =
        store.state?.selectedOrganization?.identifier || "";
      resetSearchObj();
      return true;
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

  /**
   * Resets histogram error state to default values.
   *
   * Clears all error messages, codes, and details related to histogram operations.
   * This is typically called before new histogram data is loaded or when
   * recovering from histogram-related errors.
   *
   * @example
   * ```typescript
   * resetHistogramError();
   * // Histogram errors are now cleared
   * ```
   */
  const resetHistogramError = (): void => {
    searchObj.data.histogram.errorMsg = "";
    searchObj.data.histogram.errorCode = 0;
    searchObj.data.histogram.errorDetail = "";
  };

  /**
   * Resets query-related data and pagination state.
   *
   * Clears query results, resets pagination to first page, stops any running queries,
   * and clears error messages. This function is commonly used before executing
   * new queries or when switching between different query contexts.
   *
   * @example
   * ```typescript
   * resetQueryData();
   * // Query data is now cleared and ready for new search
   * ```
   */
  const resetQueryData = (): void => {
    searchObj.data.sortedQueryResults = [];
    searchObj.data.resultGrid.currentPage = 1;
    searchObj.runQuery = false;
    searchObj.data.errorMsg = "";
    searchObj.data.errorDetail = "";
    searchObj.data.countErrorMsg = "";
  };

  /**
   * Resets search around data to default state.
   *
   * Clears the search around timestamp and size, effectively disabling
   * any active search around context. Used when starting fresh searches
   * or switching between different search modes.
   *
   * @example
   * ```typescript
   * resetSearchAroundData();
   * // Search around context is now cleared
   * ```
   */
  const resetSearchAroundData = (): void => {
    searchObj.data.searchAround.indexTimestamp = -1;
    searchObj.data.searchAround.size = 0;
  };

  /**
   * Resets all function-related data and clears store.
   *
   * Dispatches store action to clear functions and resets local function
   * data including transforms and stream functions. This ensures a clean
   * state when switching contexts or organizations.
   *
   * @example
   * ```typescript
   * resetFunctions();
   * // All function data is now cleared from store and local state
   * ```
   */
  const resetFunctions = (): void => {
    searchObj.data.transforms = [];
    searchObj.data.stream.functions = [];
    store?.dispatch("setFunctions", []);
  };

  /**
   * Comprehensively resets all stream-related data.
   *
   * This function performs a complete reset of stream state including:
   * - Dispatches store action to reset streams
   * - Clears selected streams and fields
   * - Resets filter configurations
   * - Sets stream type from route or defaults to 'logs'
   * - Calls resetQueryData() and resetSearchAroundData() for related cleanup
   *
   * @example
   * ```typescript
   * resetStreamData();
   * // All stream data, queries, and search around context are now reset
   * ```
   */
  const resetStreamData = (): void => {
    // Reset store stream data
    store.dispatch("resetStreams", {});

    // Clear stream selections and fields
    searchObj.data.stream.selectedStream = [];
    searchObj.data.stream.selectedStreamFields = [];
    searchObj.data.stream.selectedFields = [];

    // Reset filter configurations
    searchObj.data.stream.filterField = "";
    searchObj.data.stream.addToFilter = "";
    searchObj.data.stream.functions = [];

    // Set stream type from route or default to logs
    searchObj.data.stream.streamType =
      (router.currentRoute.value.query.stream_type as string) || "logs";

    // Clear stream lists
    searchObj.data.stream.streamLists = [];

    // Reset related data
    resetQueryData();
    resetSearchAroundData();
  };

  return {
    // Reactive state
    store,
    router,
    searchObj,
    searchObjDebug,
    searchAggData,
    initialQueryPayload,
    streamSchemaFieldsIndexMapping,
    fieldValues,
    notificationMsg,
    ftsFields,
    initialLogsState,
    resetSearchObj,
    resetHistogramError,
    resetQueryData,
    resetSearchAroundData,
    resetFunctions,
    resetStreamData,
    histogramMappedData,
    histogramResults,
    searchPartitionMap,
  };
};

export default searchState;

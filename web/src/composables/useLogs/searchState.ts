// Copyright 2026 OpenObserve Inc.
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
import type { SearchRequestPayload, ParsedSQLResult } from "@/ts/interfaces";
import {
  DEFAULT_LOGS_CONFIG,
  DEFAULT_SEARCH_DEBUG_DATA,
  DEFAULT_SEARCH_AGG_DATA,
} from "@/utils/logs/constants";

// Cross-link definition returned by the backend cross-linking API.
export interface CrossLinkField {
  name: string;
  alias?: string;
}
export interface CrossLink {
  name: string;
  url: string;
  fields: CrossLinkField[];
}

// A transform (VRL function) entry shown in the function selector.
export interface Transform {
  name?: string;
  function?: string;
  content?: string;
  id?: string;
  [key: string]: unknown;
}

// The currently applied transform/action; spread from a source item at runtime.
export interface SelectedTransform {
  id?: string;
  name?: string;
  type?: string;
  [key: string]: unknown;
}

// An action entry shown in the action selector.
export interface ActionItem {
  name: string;
  id: string;
}

export interface RefreshTimeItem {
  label: string;
  value: number;
}

export interface SearchConfig {
  splitterModel: number;
  lastSplitterPosition: number;
  splitterLimit: number[];
  fnSplitterModel: number;
  fnLastSplitterPosition: number;
  fnSplitterLimit: number[];
  refreshTimes: RefreshTimeItem[][];
}

export interface HistogramData {
  xData: number[];
  yData: number[];
  breakdownField: string | null;
  breakdownSeries: Map<string, number[]> | null;
  chartParams: {
    title: string;
    unparsed_x_data: unknown[];
    timezone: string;
  };
  errorMsg: string;
  errorCode: number;
  errorDetail: string;
}

export interface StreamData {
  loading?: boolean;
  // A found entry is assigned directly to selectedStream (string[]) at a call
  // site, which only type-checks if elements are any.
  streamLists: any[];
  selectedStream: string[];
  selectedStreamFields: any[];
  selectedFields: string[];
  filterField: string;
  addToFilter: string;
  addToFilterMode: "replace" | "append";
  removeFilterField: string;
  functions: { name: string; args: string }[];
  streamType: string;
  interestingFieldList: string[];
  userDefinedSchema: unknown[];
  expandGroupRows: { [key: string]: boolean };
  expandGroupRowsFieldCount: { [key: string]: number };
  filteredField: { expr: { value: string } }[];
  missingStreamMultiStreamFilter: string[];
  pipelineQueryStream: string[];
  // Holds grouped field-row objects at runtime; left as any[] for the same
  // conflicting-StreamField-shape reason as selectedStreamFields above.
  selectedInterestingStreamFields: any[];
  interestingExpandedGroupRows: { [key: string]: boolean };
  interestingExpandedGroupRowsFieldCount: { [key: string]: number };
}

export interface ResultGrid {
  currentDateTime?: Date;
  currentPage: number;
  // Column definitions vary between logs and traces grids; treated opaquely here.
  columns: unknown[];
  colOrder: { [key: string]: string[] };
  colSizes: { [key: string]: unknown };
}

export interface SearchAroundData {
  indexTimestamp: number;
  size: number;
  histogramHide: boolean;
}

export interface SearchObjectData {
  // Backend stream-list response; also reset to {} at times, so kept as any.
  streamResults: any;
  errorMsg: string;
  errorDetail: string;
  errorCode: number;
  countErrorMsg: string;
  filterErrMsg: string;
  missingStreamMessage: string;
  additionalErrorMsg?: string;
  savedViewFilterFields?: string;
  stream: StreamData;
  // Search response: hits are arbitrary log records and consumers write
  // computed props onto it, so this stays any.
  queryResults: any;
  sortedQueryResults: unknown[];
  histogram: HistogramData;
  histogramQuery: any;
  histogramInterval: number | null;
  parsedQuery?: ParsedSQLResult;
  hasSearchDataTimestampField: boolean;
  originalDataCache: { [key: string]: unknown };
  tempFunctionName: string;
  tempFunctionContent: string;
  tempFunctionLoading: boolean;
  query: string;
  editorValue: string;
  // Saved-view records are indexed by a string|number key at a call site, which
  // a typed array cannot express, so this stays any.
  savedViews: any[];
  transforms: Transform[];
  transformType: string;
  selectedTransform: SelectedTransform | null;
  selectedFunction?: { name?: string; function?: string } | null;
  actions: ActionItem[];
  actionId: string | null;
  // Polymorphic: used both flat (startTime/endTime) and nested
  // (relative.period.label) with unguarded deep access, so kept as any.
  datetime: any;
  resultGrid: ResultGrid;
  searchAround: SearchAroundData;
  customDownloadQueryObj: SearchRequestPayload;
  functionError: string;
  searchRequestTraceIds: string[];
  searchWebSocketTraceIds?: string[];
  lastSearchTraceId: string;
  lastHistogramTraceId: string;
  isOperationCancelled: boolean;
  searchRetriesCount?: { [key: string]: number };
  patterns?: unknown;
  highlightQuery: string;
  crossLinks: { stream_links: CrossLink[]; org_links: CrossLink[] };
  crossLinkQuery: string;
  sqlSyntaxErrorRanges: Array<{
    startLine: number;
    endLine: number;
    column?: number;
    error: string;
  }>;
}

export interface SearchObject {
  organizationIdentifier: string;
  config: SearchConfig;
  communicationMethod: string;
  // Large, dynamically-keyed UI/feature-flag bag with no stable schema.
  meta: any;
  data: SearchObjectData;
  runQuery: boolean;
  loading: boolean;
  loadingHistogram: boolean;
  loadingCounter: boolean;
  loadingStream: boolean;
  loadingSavedView: boolean;
  shouldIgnoreWatcher: boolean;
  // Streaming progress (0-100) for the results table and histogram bars
  loadingProgressPercentage: number;
  loadingHistogramProgressPercentage: number;
}

// Main search object containing all search state.
// DEFAULT_LOGS_CONFIG is declared `as const`, so its readonly literal type does
// not overlap with the mutable SearchObject interface; bridge via unknown.
const searchObj = reactive(Object.assign({}, DEFAULT_LOGS_CONFIG)) as unknown as SearchObject;

// Debug data for search operations
const searchObjDebug = reactive(Object.assign({}, DEFAULT_SEARCH_DEBUG_DATA));

// Aggregation data for search results
const searchAggData = reactive(Object.assign({}, DEFAULT_SEARCH_AGG_DATA));

type SearchPartition = {
  partition: number;
  chunks: Record<number, number>;
};

const searchPartitionMap = reactive<Record<string, SearchPartition>>({});

// Reassigned to a Map<string, {zo_sql_num,...}> by consumers and accessed via
// unguarded Map ops, so kept as any to avoid possibly-undefined cascades.
const histogramMappedData: any = [];

const histogramResults = ref<unknown[]>([]);

const initialQueryPayload: Ref<SearchRequestPayload | null> = ref(null);

// Field schema index mapping
const streamSchemaFieldsIndexMapping = ref<{ [key: string]: number }>({});

// Incremented each time extractFields() starts; guards against applying stale schema responses
const schemaRequestToken = ref(0);

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
  const ftsFields = ref<string[]>([]);

  /**
   * Initializes the logs state from cached store data.
   *
   * Deep-clones from the Vuex cache and resets refresh interval + query
   * results for a clean start.
   *
   * @returns Promise that resolves to true when initialization is complete
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

      searchObj.loading = false;
      searchObj.loadingHistogram = false;
      searchObj.loadingCounter = false;
      searchObj.loadingStream = false;
      searchObj.loadingSavedView = false;

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
            breakdownField: null,
            breakdownSeries: null,
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
      searchObj.data.queryResults = JSON.parse(JSON.stringify(state.data.queryResults));
      searchObj.data.sortedQueryResults = JSON.parse(JSON.stringify(state.data.sortedQueryResults));
      // Restore histogram — breakdownSeries was serialized as an entries array
      // (Map is not JSON-serializable), so reconstruct the Map here.
      const savedBreakdown = state.data.histogram.breakdownSeries;
      searchObj.data.histogram = {
        ...JSON.parse(JSON.stringify({ ...state.data.histogram, breakdownSeries: null })),
        breakdownSeries: Array.isArray(savedBreakdown) ? new Map(savedBreakdown) : null,
      };

      await nextTick();
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("Error while initializing logs state:", errorMessage);

      // Fallback to current organization and reset state
      searchObj.organizationIdentifier = store.state?.selectedOrganization?.identifier || "";
      resetSearchObj();
      return true;
    } finally {
      // eslint-disable-next-line no-unsafe-finally
      return Promise.resolve(true);
    }
  };

  /**
   * Resets the search object to its default state — streams, query results,
   * histogram, queries, and search configuration.
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
      breakdownField: null,
      breakdownSeries: null,
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
   * Resets histogram error state (message, code, detail) to default values.
   */
  const resetHistogramError = (): void => {
    searchObj.data.histogram.errorMsg = "";
    searchObj.data.histogram.errorCode = 0;
    searchObj.data.histogram.errorDetail = "";
  };

  /**
   * Resets log search error state (messages, code, details) to default values.
   */
  const resetSearchError = (): void => {
    searchObj.data.errorMsg = "";
    searchObj.data.errorDetail = "";
    searchObj.data.countErrorMsg = "";
    searchObj.data.errorCode = 0;
    searchObj.data.sqlSyntaxErrorRanges = [];
  };

  /**
   * Resets query-related data: clears results, resets pagination to page 1,
   * stops any running query, and clears errors.
   */
  const resetQueryData = (): void => {
    searchObj.data.sortedQueryResults = [];
    searchObj.data.resultGrid.currentPage = 1;
    searchObj.runQuery = false;
    resetSearchError();
  };

  /**
   * Resets search-around data (timestamp + size), disabling any active
   * search-around context.
   */
  const resetSearchAroundData = (): void => {
    searchObj.data.searchAround.indexTimestamp = -1;
    searchObj.data.searchAround.size = 0;
  };

  /**
   * Resets all function-related data (transforms + stream functions) and
   * clears functions from the store.
   */
  const resetFunctions = (): void => {
    searchObj.data.transforms = [];
    searchObj.data.stream.functions = [];
    store?.dispatch("setFunctions", []);
  };

  /**
   * Comprehensively resets all stream-related data: store streams, selections,
   * fields, filters, stream type (from route, default 'logs'), plus
   * resetQueryData() and resetSearchAroundData().
   */
  const resetStreamData = (): void => {
    // Reset store stream data
    store.dispatch("resetStreams", {});

    // Clear stream selections and fields
    searchObj.data.stream.selectedStream = [];
    searchObj.data.stream.selectedStreamFields = [];
    searchObj.data.stream.selectedFields = [];
    // The FTS system-pick marker belongs to the cleared selection.
    searchObj.meta.isFtsDefaultColumn = false;

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
    resetSearchError,
    schemaRequestToken,
  };
};

export default searchState;

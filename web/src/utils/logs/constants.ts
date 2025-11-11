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

import { useLocalWrapContent } from "@/utils/zincutils";
import { TimePeriodUnit } from "@/ts/interfaces";

/**
 * Maximum number of search retries before giving up
 */
export const MAX_SEARCH_RETRIES = 2;

/**
 * Delay between search reconnection attempts in milliseconds
 */
export const SEARCH_RECONNECT_DELAY = 1000; // 1 second

/**
 * Time interval mapping for histogram intervals
 * Values are in microseconds for backend compatibility
 */
export const INTERVAL_MAP = {
  "10 second": 10 * 1000 * 1000,
  "15 second": 15 * 1000 * 1000,
  "30 second": 30 * 1000 * 1000,
  "1 minute": 60 * 1000 * 1000,
  "5 minute": 5 * 60 * 1000 * 1000,
  "30 minute": 30 * 60 * 1000 * 1000,
  "1 hour": 60 * 60 * 1000 * 1000,
  "1 day": 24 * 60 * 60 * 1000 * 1000,
} as const;

// Time conversion constants in milliseconds
export const TIME_MULTIPLIERS: Record<TimePeriodUnit, number> = {
  s: 1000, // 1 second
  m: 60 * 1000, // 1 minute
  h: 60 * 60 * 1000, // 1 hour
  d: 24 * 60 * 60 * 1000, // 1 day
  w: 7 * 24 * 60 * 60 * 1000, // 1 week
  M: 0, // Special case - handled separately
} as const;

/**
 * Refresh time options for logs auto-refresh functionality
 * Organized in columns for UI display
 */
export const REFRESH_TIMES = [
  [
    { label: "5 sec", value: 5 },
    { label: "1 min", value: 60 },
    { label: "1 hr", value: 3600 },
  ],
  [
    { label: "10 sec", value: 10 },
    { label: "5 min", value: 300 },
    { label: "2 hr", value: 7200 },
  ],
  [
    { label: "15 sec", value: 15 },
    { label: "15 min", value: 900 },
    { label: "1 day", value: 86400 },
  ],
  [
    { label: "30 sec", value: 30 },
    { label: "30 min", value: 1800 },
  ],
] as const;

/**
 * Default configuration object for logs search functionality
 * Contains all default values and initial state
 */
export const DEFAULT_LOGS_CONFIG = {
  organizationIdentifier: "",
  runQuery: false,
  loading: false,
  loadingHistogram: false,
  loadingCounter: false,
  loadingStream: false,
  loadingSavedView: false,
  shouldIgnoreWatcher: false,
  communicationMethod: "streaming" as const,
  config: {
    splitterModel: 20,
    lastSplitterPosition: 0,
    splitterLimit: [0, 40] as const,
    fnSplitterModel: 60,
    fnLastSplitterPosition: 0,
    fnSplitterLimit: [40, 100] as const,
    refreshTimes: REFRESH_TIMES,
  },
  meta: {
    logsVisualizeToggle: "logs" as const,
    refreshInterval: 0 as number,
    refreshIntervalLabel: "Off",
    refreshHistogram: false,
    showFields: true,
    showQuery: true,
    showHistogram: true,
    showPatterns: false,
    showDetailTab: false,
    showTransformEditor: false, // by default function / actions editor should be hidden
    searchApplied: false,
    toggleSourceWrap: useLocalWrapContent()
      ? JSON.parse(useLocalWrapContent())
      : false,
    histogramDirtyFlag: false,
    logsVisualizeDirtyFlag: false,
    sqlMode: false,
    sqlModeManualTrigger: false,
    quickMode: false,
    queryEditorPlaceholderFlag: true,
    functionEditorPlaceholderFlag: true,
    resultGrid: {
      rowsPerPage: 50,
      wrapCells: false,
      manualRemoveFields: false,
      chartInterval: "1 second",
      chartKeyFormat: "HH:mm:ss",
      navigation: {
        currentRowIndex: 0,
      },
      showPagination: true,
    },
    jobId: "",
    jobRecords: "100",
    scrollInfo: {} as any,
    pageType: "logs" as const, // 'logs' or 'stream'
    regions: [] as any[],
    clusters: [] as any[],
    useUserDefinedSchemas: "user_defined_schema",
    hasUserDefinedSchemas: false,
    selectedTraceStream: "",
    showSearchScheduler: false,
    toggleFunction: false, // DEPRECATED use showTransformEditor instead
    isActionsEnabled: false,
    resetPlotChart: false,
    clearCache: false,
  },
  data: {
    query: "" as any,
    histogramQuery: "" as any,
    parsedQuery: {} as any,
    countErrorMsg: "",
    errorMsg: "",
    errorDetail: "",
    errorCode: 0,
    filterErrMsg: "",
    missingStreamMessage: "",
    additionalErrorMsg: "",
    savedViewFilterFields: "",
    hasSearchDataTimestampField: false,
    originalDataCache: {} as any,
    stream: {
      loading: false,
      streamLists: [] as object[],
      selectedStream: [] as any[],
      selectedStreamFields: [] as any[],
      selectedFields: [] as string[],
      filterField: "",
      addToFilter: "",
      functions: [] as any[],
      streamType: "logs",
      interestingFieldList: [] as string[],
      userDefinedSchema: [] as any[],
      expandGroupRows: {} as any,
      expandGroupRowsFieldCount: {} as any,
      filteredField: [] as any[],
      missingStreamMultiStreamFilter: [] as any[],
      pipelineQueryStream: [] as any[],
      selectedInterestingStreamFields: [] as string[],
      interestingExpandedGroupRows: {} as any,
      interestingExpandedGroupRowsFieldCount: {} as any,
    },
    resultGrid: {
      currentDateTime: new Date(),
      currentPage: 1,
      columns: [] as any[],
      colOrder: {} as any,
      colSizes: {} as any,
    },
    histogramInterval: 0 as any,
    transforms: [] as any[],
    transformType: "function",
    actions: [] as any[],
    selectedTransform: null as any,
    queryResults: [] as any[],
    sortedQueryResults: [] as any[],
    streamResults: [] as any[],
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
    } as any,
    patterns: {
      data: [] as any[],
      config: {} as any,
      statistics: {} as any,
    } as any,
    editorValue: "" as any,
    datetime: {
      startTime: (new Date().getTime() - 900000) * 1000,
      endTime: new Date().getTime(),
      relativeTimePeriod: "15m",
      type: "relative",
      selectedDate: {} as any,
      selectedTime: {} as any,
      queryRangeRestrictionMsg: "",
      queryRangeRestrictionInHour: 100000,
    } as any,
    searchAround: {
      indexTimestamp: 0,
      size: 10 as number,
      histogramHide: false,
    },
    tempFunctionName: "",
    tempFunctionContent: "",
    tempFunctionLoading: false,
    savedViews: [] as any[],
    customDownloadQueryObj: {} as any,
    functionError: "",
    searchRequestTraceIds: [] as string[],
    searchWebSocketTraceIds: [] as string[],
    isOperationCancelled: false,
    searchRetriesCount: {} as { [key: string]: number },
    actionId: null,
  },
} as const;

/**
 * Default search aggregation data structure
 */
export const DEFAULT_SEARCH_AGG_DATA = {
  total: 0,
  hasAggregation: false,
};

/**
 * Default debug object for performance monitoring
 */
export const DEFAULT_SEARCH_DEBUG_DATA = {
  queryDataStartTime: 0,
  queryDataEndTime: 0,
  buildSearchStartTime: 0,
  buildSearchEndTime: 0,
  partitionStartTime: 0,
  partitionEndTime: 0,
  paginatedDatawithAPIStartTime: 0,
  paginatedDatawithAPIEndTime: 0,
  pagecountStartTime: 0,
  pagecountEndTime: 0,
  paginatedDataReceivedStartTime: 0,
  paginatedDataReceivedEndTime: 0,
  histogramStartTime: 0,
  histogramEndTime: 0,
  histogramProcessingStartTime: 0,
  histogramProcessingEndTime: 0,
  extractFieldsStartTime: 0,
  extractFieldsEndTime: 0,
  extractFieldsWithAPI: "",
};

// Type definitions for constants
export type IntervalMapKey = keyof typeof INTERVAL_MAP;
export type RefreshTimeOption = (typeof REFRESH_TIMES)[number][number];
export type LogsConfig = typeof DEFAULT_LOGS_CONFIG;
export type SearchAggData = typeof DEFAULT_SEARCH_AGG_DATA;
export type SearchDebugData = typeof DEFAULT_SEARCH_DEBUG_DATA;
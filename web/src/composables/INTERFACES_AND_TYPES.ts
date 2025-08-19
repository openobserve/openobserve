/**
 * Comprehensive TypeScript interfaces and types for the split useLogs composables
 * 
 * This file defines all the interfaces, types, and contracts that will be used
 * across the new composable architecture.
 */

import { Ref, ComputedRef } from 'vue';

// ========================================
// SHARED TYPES AND INTERFACES
// ========================================

/**
 * Core search object structure - shared across all composables
 */
export interface SearchObject {
  data: SearchObjectData;
  meta: SearchObjectMeta;
  loading: boolean;
  loadingHistogram: boolean;
  loadingCounter: boolean;
  loadingStream: boolean;
  loadingSavedView: boolean;
  shouldIgnoreWatcher: boolean;
  communicationMethod: 'http' | 'ws' | 'streaming';
  [key: string]: any;
}

export interface SearchObjectData {
  query: string;
  stream: StreamData;
  queryResults: QueryResults;
  histogram: HistogramData;
  datetime: DateTimeData;
  resultGrid: ResultGridData;
  streamResults: StreamResultsData;
  filteredField: any[];
  functionError: string;
  tempFunctionContent: string;
  tempFunctionName: string;
  selectedTransform: any;
  transformType: string;
  isOperationCancelled: boolean;
  searchRequestTraceIds: string[];
  searchWebSocketTraceIds: string[];
  errorCode: number;
  filterErrMsg: string;
  missingStreamMessage: string;
  originalDataCache: Record<string, any>;
  customDownloadQueryObj: any;
  histogramQuery: any;
  [key: string]: any;
}

export interface SearchObjectMeta {
  sqlMode: boolean;
  quickMode: boolean;
  showHistogram: boolean;
  showFields: boolean;
  showQuery: boolean;
  showDetailTab: boolean;
  showTransformEditor: boolean;
  searchApplied: boolean;
  refreshInterval: number;
  refreshIntervalLabel: string;
  refreshHistogram: boolean;
  histogramDirtyFlag: boolean;
  logsVisualizeDirtyFlag: boolean;
  toggleSourceWrap: boolean;
  queryEditorPlaceholderFlag: boolean;
  functionEditorPlaceholderFlag: boolean;
  resultGrid: MetaResultGrid;
  pageType: string;
  logsVisualizeToggle: string;
  jobId: string;
  jobRecords: string;
  regions: string[];
  clusters: string[];
  resetPlotChart: boolean;
  [key: string]: any;
}

export interface StreamData {
  streamType: string;
  selectedStream: string[];
  streamLists: any[];
  selectedStreamFields: any[];
  interestingFieldList: string[];
  missingStreamMultiStreamFilter: string[];
  filteredField: any[];
  [key: string]: any;
}

export interface QueryResults {
  hits: any[];
  total: number;
  partitionDetail: PartitionDetail;
  aggs: any;
  subpage: number;
  histogram_interval: number;
  visualization_histogram_interval: number;
  is_histogram_eligible: boolean;
  [key: string]: any;
}

export interface PartitionDetail {
  partitions: [number, number][];
  paginations: PartitionPagination[][];
  partitionTotal: number[];
  [key: string]: any;
}

export interface PartitionPagination {
  startTime: number;
  endTime: number;
  from: number;
  size: number;
  streaming_output: boolean;
  streaming_id: string;
  [key: string]: any;
}

export interface HistogramData {
  xData: any[];
  yData: any[];
  chartParams: {
    title: string;
    unparsed_x_data: any[];
    timezone: string;
    [key: string]: any;
  };
  errorCode: number;
  errorMsg: string;
  errorDetail: string;
  [key: string]: any;
}

export interface DateTimeData {
  type: 'relative' | 'absolute';
  startTime: number;
  endTime: number;
  relativeTimePeriod: string;
  [key: string]: any;
}

export interface ResultGridData {
  currentPage: number;
  [key: string]: any;
}

export interface MetaResultGrid {
  rowsPerPage: number;
  wrapCells: boolean;
  chartInterval: string;
  chartKeyFormat: string;
  manualRemoval: boolean;
  currentPage: number;
  [key: string]: any;
}

export interface StreamResultsData {
  list: any[];
  [key: string]: any;
}

// ========================================
// COMPOSABLE INTERFACES
// ========================================

/**
 * 1. State Management Composable
 */
export interface UseLogsStateManagement {
  // Core state
  searchObj: Ref<SearchObject>;
  searchObjDebug: Ref<any>;
  searchAggData: Ref<any>;
  initialQueryPayload: Ref<any>;
  
  // State flags
  isInitialized: Ref<boolean>;
  refreshInterval: Ref<number>;
  
  // Functions
  clearSearchObj: () => void;
  resetSearchObj: () => void;
  initialLogsState: () => Promise<void>;
  resetFunctions: () => void;
  resetStreamData: () => void;
  resetQueryData: () => void;
  resetSearchAroundData: () => void;
  updatedLocalLogFilterField: () => void;
  enableRefreshInterval: (interval: number) => void;
}

/**
 * 2. Stream Management Composable
 */
export interface UseLogsStreamManagement {
  // State
  streamLists: ComputedRef<any[]>;
  selectedStreams: ComputedRef<string[]>;
  streamFields: ComputedRef<any[]>;
  interestingFields: ComputedRef<string[]>;
  streamType: ComputedRef<string>;
  
  // Functions
  loadStreamLists: (selectStream?: boolean) => Promise<void>;
  loadStreamFields: (streamName: string) => Promise<void>;
  getStreamList: (selectStream?: boolean) => Promise<void>;
  updateStreams: () => void;
  onStreamChange: () => void;
  setSelectedStreams: (streams: string[]) => void;
  extractFields: () => Promise<void>;
  extractFTSFields: () => void;
  reorderSelectedFields: () => void;
  hasInterestingFieldsInLocal: (streamName: string) => boolean;
  updateInterestingFieldsInLocal: () => void;
  getFieldsWithStreamNames: () => any[];
}

/**
 * 3. Query Processing Composable
 */
export interface UseLogsQueryProcessing {
  // State
  parsedQuery: ComputedRef<any>;
  queryErrors: Ref<string[]>;
  query: ComputedRef<string>;
  sqlMode: ComputedRef<boolean>;
  
  // Core Functions
  buildSearch: () => any;
  fnParsedSQL: (query?: string) => any;
  fnUnparsedSQL: (parsedObj: any) => string;
  fnHistogramParsedSQL: (query: string) => any;
  
  // Query Analysis
  isLimitQuery: (parsedSQL?: any) => boolean;
  isDistinctQuery: (parsedSQL?: any) => boolean;
  hasAggregation: (columns?: any) => boolean;
  isTimestampASC: (orderby?: any) => boolean;
  isNonAggregatedSQLMode: (searchObj: any, parsedSQL: any) => boolean;
  
  // Validation
  validateFilterForMultiStream: () => boolean;
  extractFilterColumns: (expression: any) => string[];
  
  // Transform Functions
  addTransformToQuery: (queryReq: any) => void;
  shouldAddFunctionToSearch: () => boolean;
  extractValueQuery: () => void;
  getQueryReq: () => any;
}

/**
 * 4. Data Fetching Composable
 */
export interface UseLogsDataFetching {
  // State
  isLoading: ComputedRef<boolean>;
  isSearchLoading: Ref<boolean>;
  isHistogramLoading: Ref<boolean>;
  isPageCountLoading: Ref<boolean>;
  isJobDataLoading: Ref<boolean>;
  hasActiveRequest: ComputedRef<boolean>;
  canRetry: ComputedRef<boolean>;
  lastError: Ref<any>;
  requestId: Ref<string>;
  retryCount: Ref<number>;

  // Core Functions
  executeSearchQuery: (queryRequest: any, isPagination?: boolean, appendResult?: boolean) => Promise<any>;
  processSearchResponse: (response: any, isPagination?: boolean, appendResult?: boolean) => Promise<any>;
  handleSearchError: (error: any, queryRequest: any, isPagination?: boolean, appendResult?: boolean) => Promise<void>;
  
  // Job Data
  fetchJobData: (jobId: string, isPagination?: boolean) => Promise<any>;
  
  // Search Around
  executeSearchAround: (record: any, size?: number) => Promise<any>;
  
  // Pagination
  fetchPageCount: (queryRequest: any) => Promise<number>;
  
  // Utility Functions
  cancelCurrentRequest: () => void;
  resetLoadingStates: () => void;
  resetErrorState: () => void;
  generateTraceId: () => string;
  getPerformanceMetrics: () => any;
  
  // Data Processing
  processHistogramData: (aggs: any[]) => Promise<void>;
  sortQueryResults: () => Promise<void>;
  updatePaginationState: (total: number, isPagination: boolean) => void;

  // Debug Information
  searchDebug: Ref<any>;
}

/**
 * 5. Histogram Management Composable
 */
export interface UseLogsHistogramManagement {
  // State
  histogram: ComputedRef<HistogramData>;
  loadingHistogram: ComputedRef<boolean>;
  histogramQuery: ComputedRef<any>;
  showHistogram: ComputedRef<boolean>;
  
  // Core Histogram Processing
  generateHistogramData: () => Promise<void>;
  generateHistogramSkeleton: () => Promise<void>;
  getHistogramQueryData: (queryReq: any) => Promise<void>;
  processHttpHistogramResults: (queryReq: any) => Promise<boolean>;
  
  // Configuration
  getHistogramTitle: () => string;
  setMultiStreamHistogramQuery: (queryReq: any) => string;
  shouldShowHistogram: () => boolean;
  isNonAggregatedSQLMode: (searchObj: any, parsedSQL: any) => boolean;
  
  // Error Handling
  resetHistogramWithError: (message: string, code: number) => void;
  resetHistogramError: () => void;
  
  // Utility
  processHistogramRequest: () => void;
}

/**
 * 6. WebSocket Handling Composable
 */
export interface UseLogsWebSocketHandling {
  // State
  communicationMethod: ComputedRef<string>;
  isConnected: Ref<boolean>;
  streamingData: Ref<any>;
  
  // WebSocket Operations
  buildWebSocketPayload: (queryReq: any) => any;
  sendSearchMessage: (payload: any) => void;
  setCommunicationMethod: () => void;
  getDataThroughStream: (isPagination: boolean) => void;
  
  // Streaming Handlers
  handleStreamingHits: (data: any) => void;
  handleStreamingMetadata: (data: any) => void;
  handleHistogramStreamingHits: (data: any) => void;
  handleHistogramStreamingMetadata: (data: any) => void;
  handlePageCountStreamingHits: (data: any) => void;
  handlePageCountStreamingMetadata: (data: any) => void;
  
  // Connection Management
  handleSearchClose: () => void;
  handleSearchError: (error: any) => void;
  initializeStreamingConnection: () => void;
}

/**
 * 7. Pagination Composable
 */
export interface UseLogsPagination {
  // State
  currentPage: ComputedRef<number>;
  totalPages: ComputedRef<number>;
  rowsPerPage: ComputedRef<number>;
  partitionDetail: ComputedRef<PartitionDetail>;
  
  // Pagination Operations
  refreshPartitionPagination: (regenerate?: boolean, isStreamingOutput?: boolean) => void;
  refreshPagination: (regenerate?: boolean) => void;
  refreshJobPagination: (regenerate?: boolean) => void;
  getPartitionTotalPages: (total: number) => number;
  
  // Page Management
  updatePageCountSearchSize: () => void;
  navigateToPage: (page: number) => void;
  
  // Utility
  calculatePaginationState: () => void;
}

/**
 * 8. Grid Management Composable
 */
export interface UseLogsGridManagement {
  // State
  gridColumns: Ref<any[]>;
  fieldValues: Ref<any>;
  columnSizes: Ref<{ [key: string]: number }>;
  
  // Grid Operations
  updateGridColumns: () => void;
  getColumnWidth: (column: string) => number;
  saveColumnSizes: () => void;
  filterHitsColumns: () => void;
  
  // Field Management
  updateFieldValues: () => void;
  resetFieldValues: () => void;
  
  // Data Processing
  sortResponse: (data: any[], orderBy: any[], timestampColumn: string) => void;
  updateResult: (data: any[]) => void;
  
  // Utility
  getTsValue: (column: string, record: any) => number;
}

/**
 * 9. URL Management Composable
 */
export interface UseLogsURLManagement {
  // State
  urlParams: Ref<any>;
  routeState: Ref<any>;
  
  // URL Operations
  generateURLQuery: (isShareLink?: boolean, dashboardPanelData?: any) => any;
  updateUrlQueryParams: (dashboardPanelData?: any) => void;
  restoreUrlQueryParams: () => void;
  
  // Configuration Encoding
  getVisualizationConfig: (dashboardPanelData: any) => any;
  encodeVisualizationConfig: (config: any) => string;
  decodeVisualizationConfig: (encodedConfig: string) => any;
  
  // Navigation
  routeToSearchSchedule: () => void;
  extractTimestamps: (period: string) => any;
  
  // Utility
  setDateTime: (period: string) => void;
}

// ========================================
// MAIN COMPOSABLE INTERFACE
// ========================================

/**
 * Main useLogs composable that orchestrates all sub-composables
 */
export interface UseLogsMain {
  // Sub-composables
  stateManagement: UseLogsStateManagement;
  streamManagement: UseLogsStreamManagement;
  queryProcessing: UseLogsQueryProcessing;
  dataFetching: UseLogsDataFetching;
  histogramManagement: UseLogsHistogramManagement;
  webSocketHandling: UseLogsWebSocketHandling;
  pagination: UseLogsPagination;
  gridManagement: UseLogsGridManagement;
  urlManagement: UseLogsURLManagement;
  
  // Core orchestration functions
  loadLogsData: () => Promise<void>;
  handleQueryData: () => Promise<void>;
  handleRunQuery: () => Promise<void>;
  searchAroundData: (data: any) => Promise<void>;
  
  // Legacy compatibility exports (for backward compatibility)
  searchObj: Ref<SearchObject>;
  searchAggData: Ref<any>;
  getStreams: any;
  resetSearchObj: () => void;
  resetStreamData: () => void;
  updatedLocalLogFilterField: () => void;
  getFunctions: () => Promise<void>;
  getStreamList: (selectStream?: boolean) => Promise<void>;
  fieldValues: Ref<any>;
  extractFields: () => Promise<void>;
  getQueryData: (isPagination?: boolean) => Promise<void>;
  getJobData: (isPagination?: boolean) => Promise<void>;
  searchAroundData: (data: any) => Promise<void>;
  updateGridColumns: () => void;
  refreshData: () => void;
  updateUrlQueryParams: (dashboardPanelData?: any) => void;
  restoreUrlQueryParams: () => void;
  updateStreams: () => void;
  generateHistogramData: () => Promise<void>;
  onStreamChange: () => void;
  generateURLQuery: (isShareLink?: boolean, dashboardPanelData?: any) => any;
  buildSearch: () => any;
  loadStreamLists: (selectStream?: boolean) => Promise<void>;
  refreshPartitionPagination: (regenerate?: boolean, isStreamingOutput?: boolean) => void;
  filterHitsColumns: () => void;
  getHistogramQueryData: (queryReq: any) => Promise<void>;
  generateHistogramSkeleton: () => Promise<void>;
  fnParsedSQL: (query?: string) => any;
  fnUnparsedSQL: (parsedObj: any) => string;
  getRegionInfo: () => any;
  validateFilterForMultiStream: () => boolean;
  cancelQuery: () => void;
  // ... other legacy exports as needed
}

// ========================================
// SHARED CONFIGURATION AND UTILITIES
// ========================================

/**
 * Configuration for composable initialization
 */
export interface ComposableConfig {
  enableWebSocket?: boolean;
  enableStreaming?: boolean;
  enableHistogram?: boolean;
  defaultPageSize?: number;
  [key: string]: any;
}

/**
 * Event types for cross-composable communication
 */
export interface LogsEvents {
  streamChanged: string[];
  queryBuilt: any;
  dataFetched: any[];
  histogramGenerated: HistogramData;
  paginationChanged: { page: number; size: number };
  errorOccurred: { error: Error; context: string };
  stateReset: void;
}

/**
 * Utility types
 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export type CommunicationMethod = 'http' | 'ws' | 'streaming';
export type QueryMode = 'sql' | 'natural';
export type TimeRangeType = 'relative' | 'absolute';

/**
 * Function type definitions for callbacks and handlers
 */
export type ErrorHandler = (error: Error, context?: string) => void;
export type StateUpdateHandler = (newState: Partial<SearchObject>) => void;
export type QueryChangeHandler = (query: string, mode: QueryMode) => void;
export type DataReceivedHandler = (data: any[]) => void;

/**
 * Composable factory function types
 */
export type StateManagementFactory = (config?: ComposableConfig) => UseLogsStateManagement;
export type StreamManagementFactory = (state: Ref<SearchObject>) => UseLogsStreamManagement;
export type QueryProcessingFactory = (state: Ref<SearchObject>) => UseLogsQueryProcessing;
export type DataFetchingFactory = (state: Ref<SearchObject>, queryProcessor: UseLogsQueryProcessing) => UseLogsDataFetching;
export type HistogramManagementFactory = (state: Ref<SearchObject>, dataFetcher: UseLogsDataFetching) => UseLogsHistogramManagement;
export type WebSocketHandlingFactory = (state: Ref<SearchObject>, dataFetcher: UseLogsDataFetching) => UseLogsWebSocketHandling;
export type PaginationFactory = (state: Ref<SearchObject>) => UseLogsPagination;
export type GridManagementFactory = (state: Ref<SearchObject>, pagination: UseLogsPagination) => UseLogsGridManagement;
export type URLManagementFactory = (state: Ref<SearchObject>) => UseLogsURLManagement;

/**
 * Export default factory function type
 */
export type UseLogsFactory = (config?: ComposableConfig) => UseLogsMain;
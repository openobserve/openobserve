# useLogs.ts Composable Splitting Plan

## Overview
The current `useLogs.ts` file contains over 7000 lines of code with ~120 functions. This document outlines a comprehensive plan to split this into 9 smaller, focused composables.

## Proposed Composable Structure

### 1. **useLogsStreamManagement.ts**
**Purpose**: Manages stream-related operations, field management, and stream selection.

**Functions to Move:**
- `loadStreamLists()` (line 577)
- `loadStreamFields()` (line 628) 
- `getStreamList()` (line 650)
- `updateStreams()` (line 4772)
- `onStreamChange()` (line 4830)
- `setSelectedStreams()` (line 5177)
- `getFieldsWithStreamNames()` (line 5091)
- `extractFields()` (line 2408)
- `extractFTSFields()` (line 4794)
- `reorderSelectedFields()` (line 5072)
- `hasInterestingFieldsInLocal()` (line 3416)
- `updateInterestingFieldsInLocal()` (line 3448)

**Data Dependencies:**
- `searchObj.data.stream.*`
- `searchObj.data.streamResults.*`
- Stream-related stores and configurations

**Export Interface:**
```typescript
interface UseLogsStreamManagement {
  // Functions
  loadStreamLists: (selectStream?: boolean) => Promise<void>
  loadStreamFields: (streamName: string) => Promise<void>
  getStreamList: (selectStream?: boolean) => Promise<void>
  updateStreams: () => void
  onStreamChange: () => void
  setSelectedStreams: (streams: string[]) => void
  extractFields: () => Promise<void>
  extractFTSFields: () => void
  
  // Reactive State
  streamLists: Ref<any[]>
  selectedStreams: Ref<string[]>
  streamFields: Ref<any[]>
  interestingFields: Ref<string[]>
}
```

---

### 2. **useLogsQueryProcessing.ts**
**Purpose**: Handles query construction, parsing, and validation.

**Functions to Move:**
- `buildSearch()` (line 867) - **CORE FUNCTION**
- `fnParsedSQL()` (line 2221)
- `fnUnparsedSQL()` (line 2253)
- `fnHistogramParsedSQL()` (line 2263)
- `validateFilterForMultiStream()` (line 817)
- `isLimitQuery()` (line 1058)
- `isDistinctQuery()` (line 1062)
- `hasAggregation()` (line 2210)
- `isTimestampASC()` (line 2149)
- `extractFilterColumns()` (line 790)
- `extractValueQuery()` (line 5275)
- `getQueryReq()` (line 5412)
- `shouldAddFunctionToSearch()` (line 2116)
- `addTransformToQuery()` (line 2122)

**Data Dependencies:**
- `searchObj.data.query`
- `searchObj.meta.sqlMode`
- `searchObj.data.stream.selectedStreamFields`
- Parser instances and SQL processing utilities

**Export Interface:**
```typescript
interface UseLogsQueryProcessing {
  // Core Functions
  buildSearch: () => any
  fnParsedSQL: (query?: string) => any
  fnUnparsedSQL: (parsedObj: any) => string
  validateFilterForMultiStream: () => boolean
  
  // Query Analysis
  isLimitQuery: (parsedSQL?: any) => boolean
  isDistinctQuery: (parsedSQL?: any) => boolean
  hasAggregation: (columns?: any) => boolean
  isTimestampASC: (orderby?: any) => boolean
  
  // Transform Functions
  addTransformToQuery: (queryReq: any) => void
  shouldAddFunctionToSearch: () => boolean
  
  // State
  parsedQuery: Ref<any>
  queryErrors: Ref<string[]>
}
```

---

### 3. **useLogsDataFetching.ts**
**Purpose**: Manages all data fetching operations, API calls, and error handling.

**Functions to Move:**
- `getQueryData()` (line 1590) - **CORE FUNCTION**
- `getJobData()` (line 2026)
- `getPageCount()` (line 2282)
- `getQueryPartitions()` (line 1066)
- `getPaginatedData()` (line 2443)
- `getFunctions()` (line 486)
- `getActions()` (line 519)
- `getSavedViews()` (line 4810)
- `fetchAllParitions()` (line 2418)
- `processPostPaginationData()` (line 2404)
- `addTraceId()` (line 4963)
- `removeTraceId()` (line 4979)
- `getRegionInfo()` (line 4943)

**Data Dependencies:**
- API service calls
- `searchObj.data.queryResults.*`
- `searchObj.loading` states
- Trace ID management

**Export Interface:**
```typescript
interface UseLogsDataFetching {
  // Core Data Fetching
  getQueryData: (isPagination?: boolean) => Promise<void>
  getJobData: (isPagination?: boolean) => Promise<void>
  getPaginatedData: (queryReq: any, isInitialRequest?: boolean) => Promise<boolean>
  
  // Metadata Fetching
  getPageCount: (queryReq: any) => Promise<boolean>
  getQueryPartitions: (queryReq: any) => Promise<void>
  getFunctions: () => Promise<void>
  getActions: () => Promise<void>
  getSavedViews: () => Promise<void>
  
  // Utility
  processPostPaginationData: () => void
  addTraceId: (traceId: string) => void
  removeTraceId: (traceId: string) => void
  
  // State
  loading: Ref<boolean>
  loadingHistogram: Ref<boolean>
  queryResults: Ref<any>
  traceIds: Ref<string[]>
}
```

---

### 4. **useLogsHistogramManagement.ts**
**Purpose**: Handles histogram generation, processing, and visualization.

**Functions to Move:**
- `processHttpHistogramResults()` (line 1946)
- `generateHistogramData()` (line 4169)
- `generateHistogramSkeleton()` (line 2165)
- `getHistogramTitle()` (line 4076)
- `getHistogramQueryData()` (line 2949)
- `setMultiStreamHistogramQuery()` (line 1567)
- `resetHistogramWithError()` (line 2134)
- `resetHistogramError()` (line 6464)
- `shouldShowHistogram()` (line 6470)
- `processHistogramRequest()` (line 6476)
- `isNonAggregatedSQLMode()` (helper function)

**Data Dependencies:**
- `searchObj.data.histogram.*`
- `searchObj.meta.showHistogram`
- `searchObj.loadingHistogram`
- Histogram configuration and chart parameters

**Export Interface:**
```typescript
interface UseLogsHistogramManagement {
  // Core Histogram Processing
  generateHistogramData: () => Promise<void>
  generateHistogramSkeleton: () => Promise<void>
  getHistogramQueryData: (queryReq: any) => Promise<void>
  processHttpHistogramResults: (queryReq: any) => Promise<boolean>
  
  // Configuration
  getHistogramTitle: () => string
  setMultiStreamHistogramQuery: (queryReq: any) => string
  shouldShowHistogram: () => boolean
  
  // Error Handling
  resetHistogramWithError: (message: string, code: number) => void
  resetHistogramError: () => void
  
  // State
  histogram: Ref<any>
  loadingHistogram: Ref<boolean>
  histogramQuery: Ref<any>
  showHistogram: Ref<boolean>
}
```

---

### 5. **useLogsWebSocketHandling.ts**
**Purpose**: Manages WebSocket connections, streaming data, and real-time communication.

**Functions to Move:**
- `buildWebSocketPayload()` (line 5596)
- `sendSearchMessage()` (line 5736)
- `handleStreamingHits()` (line 5786)
- `handleStreamingMetadata()` (line 5808)
- `handleHistogramStreamingHits()` (line 5917)
- `handleHistogramStreamingMetadata()` (line 6028)
- `handlePageCountStreamingHits()` (line 6056)
- `handlePageCountStreamingMetadata()` (line 6078)
- `handleSearchClose()` (line 6590)
- `handleSearchError()` (line 6654)
- `setCommunicationMethod()` (line 1552)
- `getDataThroughStream()` (if exists)

**Data Dependencies:**
- WebSocket connections and configurations
- Streaming data handling
- `searchObj.communicationMethod`

**Export Interface:**
```typescript
interface UseLogsWebSocketHandling {
  // WebSocket Operations
  buildWebSocketPayload: (queryReq: any) => any
  sendSearchMessage: (payload: any) => void
  setCommunicationMethod: () => void
  
  // Streaming Handlers
  handleStreamingHits: (data: any) => void
  handleStreamingMetadata: (data: any) => void
  handleHistogramStreamingHits: (data: any) => void
  handleHistogramStreamingMetadata: (data: any) => void
  handlePageCountStreamingHits: (data: any) => void
  handlePageCountStreamingMetadata: (data: any) => void
  
  // Connection Management
  handleSearchClose: () => void
  handleSearchError: (error: any) => void
  
  // State
  communicationMethod: Ref<string>
  isConnected: Ref<boolean>
  streamingData: Ref<any>
}
```

---

### 6. **useLogsPagination.ts**
**Purpose**: Manages pagination logic, page calculations, and navigation.

**Functions to Move:**
- `refreshPartitionPagination()` (line 1335)
- `refreshPagination()` (line 6722)
- `refreshJobPagination()` (line 6763)
- `getPartitionTotalPages()` (line 1536)
- `updatePageCountSearchSize()` (line 5905)
- Related pagination utility functions

**Data Dependencies:**
- `searchObj.data.resultGrid.*`
- `searchObj.data.queryResults.partitionDetail.*`
- Pagination configuration and state

**Export Interface:**
```typescript
interface UseLogsPagination {
  // Pagination Operations
  refreshPartitionPagination: (regenerate?: boolean, isStreamingOutput?: boolean) => void
  refreshPagination: (regenerate?: boolean) => void
  refreshJobPagination: (regenerate?: boolean) => void
  getPartitionTotalPages: (total: number) => number
  
  // Page Management
  updatePageCountSearchSize: () => void
  navigateToPage: (page: number) => void
  
  // State
  currentPage: Ref<number>
  totalPages: Ref<number>
  rowsPerPage: Ref<number>
  partitionDetail: Ref<any>
}
```

---

### 7. **useLogsGridManagement.ts**
**Purpose**: Manages grid display, column configuration, and field management.

**Functions to Move:**
- `updateGridColumns()` (line 3844)
- `getColumnWidth()` (line 4045)
- `updateFieldValues()` (line 3217)
- `resetFieldValues()` (line 3251)
- `filterHitsColumns()` (line 2917)
- `saveColumnSizes()` (line 4550)
- `sortResponse()` (line 2861)
- `updateResult()` (line 6229)
- Column-related utility functions

**Data Dependencies:**
- `searchObj.data.queryResults.hits`
- Grid column configurations
- Field display preferences

**Export Interface:**
```typescript
interface UseLogsGridManagement {
  // Grid Operations
  updateGridColumns: () => void
  getColumnWidth: (column: string) => number
  saveColumnSizes: () => void
  filterHitsColumns: () => void
  
  // Field Management
  updateFieldValues: () => void
  resetFieldValues: () => void
  sortResponse: (data: any[], orderBy: any[]) => void
  
  // Result Updates
  updateResult: (data: any[]) => void
  
  // State
  gridColumns: Ref<any[]>
  fieldValues: Ref<any>
  columnSizes: Ref<{ [key: string]: number }>
}
```

---

### 8. **useLogsURLManagement.ts**
**Purpose**: Manages URL parameters, routing, and state persistence.

**Functions to Move:**
- `generateURLQuery()` (line 691)
- `updateUrlQueryParams()` (line 778)
- `restoreUrlQueryParams()` (line 4618)
- `getVisualizationConfig()` (line 666)
- `encodeVisualizationConfig()` (line 673)
- `decodeVisualizationConfig()` (line 682)
- `routeToSearchSchedule()` (line 2939)
- `extractTimestamps()` (line 4576)

**Data Dependencies:**
- Router instance
- URL query parameters
- State serialization/deserialization

**Export Interface:**
```typescript
interface UseLogsURLManagement {
  // URL Operations
  generateURLQuery: (isShareLink?: boolean, dashboardPanelData?: any) => any
  updateUrlQueryParams: (dashboardPanelData?: any) => void
  restoreUrlQueryParams: () => void
  
  // Configuration Encoding
  getVisualizationConfig: (dashboardPanelData: any) => any
  encodeVisualizationConfig: (config: any) => string
  decodeVisualizationConfig: (encodedConfig: string) => any
  
  // Navigation
  routeToSearchSchedule: () => void
  extractTimestamps: (period: string) => any
  
  // State
  urlParams: Ref<any>
  routeState: Ref<any>
}
```

---

### 9. **useLogsStateManagement.ts**
**Purpose**: Manages core application state, initialization, and cleanup.

**Functions to Move:**
- `clearSearchObj()` (line 363)
- `initialLogsState()` (line 391)
- `resetSearchObj()` (line 439)
- `resetFunctions()` (line 479)
- `resetStreamData()` (line 541)
- `resetQueryData()` (line 556)
- `resetSearchAroundData()` (line 572)
- `updatedLocalLogFilterField()` (line 467)
- `enableRefreshInterval()` (line 4749)
- State initialization and cleanup functions

**Data Dependencies:**
- Core `searchObj` state
- Store management
- Local storage operations

**Export Interface:**
```typescript
interface UseLogsStateManagement {
  // State Management
  clearSearchObj: () => void
  resetSearchObj: () => void
  initialLogsState: () => Promise<void>
  
  // Data Reset Operations
  resetFunctions: () => void
  resetStreamData: () => void
  resetQueryData: () => void
  resetSearchAroundData: () => void
  
  // Configuration
  updatedLocalLogFilterField: () => void
  enableRefreshInterval: (interval: number) => void
  
  // State
  searchObj: Ref<any>
  isInitialized: Ref<boolean>
  refreshInterval: Ref<number>
}
```

---

## Main useLogs.ts After Refactoring

After splitting, the main `useLogs.ts` file will become an orchestrator that:

1. **Imports all sub-composables**
2. **Manages cross-composable communication**
3. **Exposes a unified interface**
4. **Handles initialization and cleanup**

**Estimated New Size**: ~1000-1500 lines (reduced by 80%+)

### Main Functions Remaining in useLogs.ts:
- `loadLogsData()` - Orchestrates loading sequence
- `handleQueryData()` - Orchestrates query handling
- `handleRunQuery()` - Orchestrates query execution
- `searchAroundData()` - Core search around functionality
- Cross-composable coordination functions
- Main export function that combines all composables

---

## Implementation Strategy

### Phase 1: Extract Independent Composables
1. **useLogsURLManagement** (least dependencies)
2. **useLogsStateManagement** (foundation)
3. **useLogsStreamManagement** (depends on state)

### Phase 2: Extract Core Logic Composables  
4. **useLogsQueryProcessing** (depends on streams & state)
5. **useLogsPagination** (depends on query processing)
6. **useLogsGridManagement** (depends on data structure)

### Phase 3: Extract Complex Composables
7. **useLogsHistogramManagement** (depends on query & data)
8. **useLogsDataFetching** (depends on query & streams)
9. **useLogsWebSocketHandling** (depends on data fetching)

### Phase 4: Refactor Main useLogs.ts
- Integrate all composables
- Maintain backward compatibility
- Add proper TypeScript interfaces
- Update tests

---

## Benefits of This Approach

1. **Maintainability**: Each composable has a single responsibility
2. **Testability**: Easier to unit test individual composables
3. **Reusability**: Composables can be reused in other components
4. **Performance**: Smaller bundle sizes and better tree-shaking
5. **Developer Experience**: Easier to navigate and understand code
6. **Scalability**: Easier to add new features to specific areas

---

## Migration Considerations

1. **Shared State**: Some state will need to be shared between composables
2. **Circular Dependencies**: Avoid circular imports between composables
3. **Type Safety**: Maintain strong TypeScript interfaces
4. **Testing**: Update existing tests to work with new structure
5. **Documentation**: Update documentation to reflect new architecture

This plan provides a clear path to break down the monolithic `useLogs.ts` file into manageable, focused composables while maintaining all existing functionality.
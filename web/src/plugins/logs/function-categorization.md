# useLogs Function Categorization

## Function Analysis & Categorization

Based on the analysis of the 6,876-line useLogs.ts file, here are all functions categorized by responsibility:

## 1. STATE MANAGEMENT (→ useLogsState.ts)
*Reactive state, initialization, and state management*

### Core State Objects
- `searchObj` - Main reactive search state object
- `searchAggData` - Aggregation data state
- `searchObjDebug` - Debug state object
- `streamSchemaFieldsIndexMapping` - Field index mapping

### State Management Functions
- `resetSearchObj()` - Reset search object to defaults
- `resetStreamData()` - Reset stream-related data
- `clearSearchObj()` - Clear search object
- `initialLogsState()` - Initialize logs state from store
- `fieldValues` - Reactive field values reference

### Configuration State
- `defaultObject` - Default configuration object
- `intervalMap` - Time interval mapping
- `searchPartitionMap` - Partition mapping state

## 2. STREAM OPERATIONS (→ useLogsStreams.ts)
*Stream selection, management, and stream-related operations*

### Stream Management
- `getStreams()` - Get available streams
- `getStreamList()` - Get and process stream list
- `loadStreamLists()` - Load streams asynchronously
- `getStream()` - Get specific stream data
- `onStreamChange()` - Handle stream selection changes
- `updateStreams()` - Update stream selections
- `setSelectedStreams()` - Set selected streams

### Stream Utilities
- `extractFields()` - Extract fields from streams
- `extractFTSFields()` - Extract full-text search fields
- `updatedLocalLogFilterField()` - Update local log filter field

## 3. QUERY OPERATIONS (→ useLogsQuery.ts)
*Query building, execution, parsing, and validation*

### Query Building & Execution
- `buildSearch()` - Build search query
- `handleRunQuery()` - Execute query
- `getQueryData()` - Get query results
- `loadLogsData()` - Load logs data
- `handleQueryData()` - Process query data
- `cancelQuery()` - Cancel running query

### Query Parsing & Validation
- `fnParsedSQL()` - Parse SQL query
- `fnUnparsedSQL()` - Unparse SQL query
- `validateFilterForMultiStream()` - Validate filters for multiple streams
- `isLimitQuery()` - Check if query has LIMIT clause
- `isDistinctQuery()` - Check if query has DISTINCT clause
- `hasAggregation()` - Check if query has aggregation

### Query Utilities
- `buildQueryPayload()` - Build query request payload
- `getQueryPartitions()` - Get query partitions
- `extractValueQuery()` - Extract value from query
- `extractTimestamps()` - Extract timestamp information

## 4. FILTERING & FIELD OPERATIONS (→ useLogsFilters.ts)
*Field filtering, column management, and filter operations*

### Field Operations
- `updateGridColumns()` - Update grid column configuration
- `filterHitsColumns()` - Filter hit columns
- `reorderSelectedFields()` - Reorder selected fields
- `getFilterExpressionByFieldType()` - Get filter expression by field type

### Filter Management
- `updatedLocalLogFilterField()` - Update local log filter fields

## 5. VISUALIZATION & HISTOGRAM (→ useLogsVisualization.ts)
*Histogram generation, visualization, and chart operations*

### Histogram Operations
- `generateHistogramData()` - Generate histogram data
- `getHistogramQueryData()` - Get histogram query data
- `generateHistogramSkeleton()` - Generate histogram skeleton
- `resetHistogramWithError()` - Reset histogram with error state
- `processHttpHistogramResults()` - Process HTTP histogram results
- `loadVisualizeData()` - Load visualization data

### Visualization Configuration
- `getVisualizationConfig()` - Get visualization configuration
- `encodeVisualizationConfig()` - Encode visualization config
- `decodeVisualizationConfig()` - Decode visualization config

## 6. WEBSOCKET & COMMUNICATION (→ useLogsWebSocket.ts)
*WebSocket connections, real-time communication*

### WebSocket Operations
- `buildWebSocketPayload()` - Build WebSocket payload
- `initializeSearchConnection()` - Initialize search connection
- `sendCancelSearchMessage()` - Send cancel message via WebSocket
- `setCommunicationMethod()` - Set communication method (HTTP/WebSocket)

## 7. URL & ROUTING (→ useLogsURL.ts)
*URL parameter management, routing operations*

### URL Operations
- `generateURLQuery()` - Generate URL query parameters
- `updateUrlQueryParams()` - Update URL query parameters
- `restoreUrlQueryParams()` - Restore URL query parameters
- `routeToSearchSchedule()` - Route to search schedule

## 8. DATA OPERATIONS (→ useLogsActions.ts)
*Data refresh, pagination, job management*

### Data Refresh Operations
- `refreshData()` - Refresh data
- `refreshPagination()` - Refresh pagination
- `refreshPartitionPagination()` - Refresh partition pagination
- `refreshJobPagination()` - Refresh job pagination

### Job Operations
- `getJobData()` - Get job data
- `loadJobData()` - Load job data
- `searchAroundData()` - Search around specific data

### Actions & Functions
- `getFunctions()` - Get available functions
- `getActions()` - Get available actions
- `isActionsEnabled()` - Check if actions are enabled

## 9. API CALLS (→ services/logs/)
*HTTP requests, API communication, external service calls*

### Search API Calls
- Direct API calls within `getQueryData()`
- Search service calls within `buildSearch()`
- Histogram API calls within `getHistogramQueryData()`

### Stream API Calls
- Stream listing API calls within `getStreamList()`
- Stream schema API calls

### Saved Views API Calls
- `getSavedViews()` - Get saved views from API

### Job API Calls
- Job status API calls within job-related functions

## 10. UTILITY FUNCTIONS (→ utils/logs/)
*Pure utility functions, formatters, validators, parsers*

### Date/Time Utilities (→ utils/logs/datetime.ts)
- Time interval calculations within `buildSearch()`
- Timestamp extraction logic
- Date formatting functions

### Data Formatters (→ utils/logs/formatters.ts)
- Field value formatting
- Query result formatting
- Display formatting functions

### Validators (→ utils/logs/validators.ts)
- Query validation logic
- Field validation functions
- Input validation utilities

### Parsers (→ utils/logs/parsers.ts)
- SQL parsing utilities
- Query string parsing
- Configuration parsing

### Constants (→ utils/logs/constants.ts)
- `defaultObject` configuration
- `intervalMap` definitions
- `maxSearchRetries`, `searchReconnectDelay`
- Refresh time configurations

## 11. MISCELLANEOUS OPERATIONS
*Other operations that may need special handling*

### Region & Configuration
- `getRegionInfo()` - Get region information

### Utility Operations
- `addTraceId()` - Add trace ID to requests
- `enableRefreshInterval()` - Enable refresh interval

## REFACTORING PRIORITY ORDER

### Phase 1: Low Risk (Utilities)
1. **Constants** - Move to `utils/logs/constants.ts`
2. **Date/Time utilities** - Move to `utils/logs/datetime.ts`
3. **Formatters** - Move to `utils/logs/formatters.ts`
4. **Validators** - Move to `utils/logs/validators.ts`
5. **Parsers** - Move to `utils/logs/parsers.ts`

### Phase 2: Medium Risk (API Layer)
1. **Search API** - Move to `services/logs/logsApi.ts`
2. **Stream API** - Move to `services/logs/streamsApi.ts`
3. **Jobs API** - Move to `services/logs/jobsApi.ts`
4. **Saved Views API** - Move to `services/logs/savedViewsApi.ts`

### Phase 3: High Risk (Composable Split)
1. **State Management** - Move to `useLogsState.ts`
2. **Stream Operations** - Move to `useLogsStreams.ts`
3. **Query Operations** - Move to `useLogsQuery.ts`
4. **Filtering** - Move to `useLogsFilters.ts`
5. **Visualization** - Move to `useLogsVisualization.ts`
6. **WebSocket** - Move to `useLogsWebSocket.ts`
7. **URL Management** - Move to `useLogsURL.ts`
8. **Data Operations** - Move to `useLogsActions.ts`

## FUNCTION DEPENDENCIES

### High Dependency Functions (Extract Last)
- `searchObj` - Used by almost every function
- `buildSearch()` - Central query building logic
- `handleRunQuery()` - Core execution logic

### Low Dependency Functions (Extract First)
- Time formatting utilities
- Validation functions
- Constants and configuration
- Pure utility functions

### Medium Dependency Functions (Extract Middle)
- API calling functions
- Field extraction utilities
- URL parameter handling

---

**Next Steps:**
1. Start with Phase 1 - Constants and utilities
2. Test each extraction thoroughly
3. Update imports incrementally
4. Maintain backward compatibility at each step
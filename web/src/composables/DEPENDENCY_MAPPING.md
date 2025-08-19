# useLogs.ts Function Dependencies and Data Flow Mapping

## Core Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Main useLogs.ts                         │
│                     (Orchestrator)                             │
└─────────────────────┬───────────────────────────────────────────┘
                      │
    ┌─────────────────┼─────────────────┐
    │                 │                 │
    ▼                 ▼                 ▼
┌─────────┐    ┌─────────────┐    ┌──────────────┐
│  State  │    │   Stream    │    │    URL       │
│ Mgmt    │    │    Mgmt     │    │    Mgmt      │
└────┬────┘    └──────┬──────┘    └──────┬───────┘
     │                │                  │
     │                ▼                  │
     │        ┌─────────────┐            │
     │        │   Query     │            │
     │        │ Processing  │            │
     │        └──────┬──────┘            │
     │               │                   │
     │               ▼                   │
     │        ┌─────────────┐            │
     │        │    Data     │            │
     └────────│  Fetching   │────────────┘
              └──────┬──────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
   ┌─────────┐  ┌─────────┐  ┌─────────┐
   │Histogram│  │WebSocket│  │Pagination│
   │  Mgmt   │  │Handling │  │         │
   └─────────┘  └─────────┘  └─────────┘
        │            │            │
        └────────────┼────────────┘
                     │
                     ▼
              ┌─────────────┐
              │    Grid     │
              │   Mgmt      │
              └─────────────┘
```

## Detailed Dependency Analysis

### 1. Core State Dependencies (searchObj)

**Primary State Object Structure:**
```typescript
searchObj = {
  data: {
    query: string                    // Used by: QueryProcessing, DataFetching
    stream: {                        // Used by: StreamManagement
      streamType: string
      selectedStream: string[]
      streamLists: any[]
      selectedStreamFields: any[]
      interestingFieldList: string[]
    },
    queryResults: {                  // Used by: DataFetching, Pagination, Grid
      hits: any[]
      partitionDetail: any
      aggs: any
    },
    histogram: any                   // Used by: HistogramManagement
    datetime: {                      // Used by: QueryProcessing, URLManagement
      type: string
      startTime: number
      endTime: number
    }
  },
  meta: {                           // Used by: Multiple composables
    sqlMode: boolean
    showHistogram: boolean
    refreshInterval: number
    resultGrid: any
  },
  loading: boolean                  // Used by: DataFetching, State
  communicationMethod: string       // Used by: WebSocketHandling
}
```

### 2. Function Dependency Chains

#### **Primary Data Flow Chain:**
```
loadLogsData() →
├── resetFunctions() [StateManagement]
├── getStreamList() [StreamManagement] 
├── getFunctions() [DataFetching]
├── getActions() [DataFetching]
├── extractFields() [StreamManagement]
└── getQueryData() [DataFetching]
    ├── buildSearch() [QueryProcessing]
    ├── getQueryPartitions() [DataFetching]
    ├── getPaginatedData() [DataFetching]
    └── generateHistogramData() [HistogramManagement]
```

#### **Query Processing Chain:**
```
buildSearch() [QueryProcessing] →
├── fnParsedSQL() [QueryProcessing]
├── validateFilterForMultiStream() [QueryProcessing]
├── buildQueryPayload() [QueryProcessing] - FROM useQuery.ts
└── updateUrlQueryParams() [URLManagement]
```

#### **Data Fetching Chain:**
```
getQueryData() [DataFetching] →
├── setCommunicationMethod() [WebSocketHandling]
├── buildSearch() [QueryProcessing]
├── resetQueryData() [StateManagement]
├── getQueryPartitions() [DataFetching]
├── addTransformToQuery() [QueryProcessing]
├── getPaginatedData() [DataFetching]
└── Histogram Processing Chain...
```

#### **Histogram Processing Chain:**
```
Histogram Processing →
├── generateHistogramSkeleton() [HistogramManagement]
├── getHistogramQueryData() [HistogramManagement]
├── generateHistogramData() [HistogramManagement]
└── refreshPartitionPagination() [Pagination]
```

### 3. Composable Interdependencies

#### **High-Level Dependencies (Must be initialized first):**
1. **useLogsStateManagement** - No dependencies (foundation)
2. **useLogsURLManagement** - Depends on: State
3. **useLogsStreamManagement** - Depends on: State

#### **Mid-Level Dependencies:**
4. **useLogsQueryProcessing** - Depends on: State, Stream, URL
5. **useLogsPagination** - Depends on: State, Query
6. **useLogsGridManagement** - Depends on: State, Pagination

#### **High-Level Dependencies (Complex logic):**
7. **useLogsDataFetching** - Depends on: State, Query, Stream, Pagination
8. **useLogsHistogramManagement** - Depends on: State, Query, Data
9. **useLogsWebSocketHandling** - Depends on: Data, Query, State

### 4. Shared State Management Strategy

#### **Option 1: Centralized State (Recommended)**
```typescript
// Core state managed in main useLogs.ts
const coreState = reactive({
  searchObj,
  searchObjDebug,
  searchAggData,
  // ... other shared state
});

// Passed to each composable
const streamManagement = useLogsStreamManagement(coreState);
const queryProcessing = useLogsQueryProcessing(coreState);
// ... etc
```

#### **Option 2: State Injection**
```typescript
// Each composable receives relevant state slices
const streamManagement = useLogsStreamManagement({
  stream: toRef(searchObj.data, 'stream'),
  streamResults: toRef(searchObj.data, 'streamResults')
});
```

### 5. Critical Function Interactions

#### **buildSearch() Dependencies:**
```
buildSearch() requires:
├── searchObj.data.query
├── searchObj.meta.sqlMode  
├── searchObj.data.stream.selectedStreamFields
├── searchObj.data.datetime.*
├── fnParsedSQL() [Same composable]
├── validateFilterForMultiStream() [Same composable]
├── buildQueryPayload() [useQuery.ts - External]
└── updateUrlQueryParams() [URLManagement]
```

#### **getQueryData() Dependencies:**
```
getQueryData() requires:
├── buildSearch() [QueryProcessing]
├── setCommunicationMethod() [WebSocketHandling]
├── getDataThroughStream() [WebSocketHandling] 
├── resetQueryData() [StateManagement]
├── getQueryPartitions() [DataFetching - Same composable]
├── addTransformToQuery() [QueryProcessing]
├── getPaginatedData() [DataFetching - Same composable]
├── Multiple histogram functions [HistogramManagement]
└── refreshPartitionPagination() [Pagination]
```

### 6. Cross-Composable Communication Patterns

#### **Event-Based Communication:**
```typescript
// Example: When stream changes, notify other composables
const streamEvents = useEventBus<{
  streamChanged: string[];
  fieldsUpdated: any[];
  queryBuilt: any;
}>();

// In StreamManagement
const onStreamChange = () => {
  // ... stream change logic
  streamEvents.emit('streamChanged', selectedStreams.value);
};

// In QueryProcessing  
streamEvents.on('streamChanged', (streams) => {
  // Rebuild query when streams change
  invalidateQuery();
});
```

#### **Reactive Dependencies:**
```typescript
// Cross-composable reactive dependencies
const { buildSearch } = useLogsQueryProcessing(state);
const { getQueryData } = useLogsDataFetching(state, { buildSearch });

// buildSearch changes trigger data refetch
watch(
  () => [state.data.query, state.data.stream.selectedStream],
  () => getQueryData()
);
```

### 7. External Dependencies

#### **Service Dependencies:**
- `searchService` - Used by: DataFetching
- `savedviewsService` - Used by: DataFetching  
- `useStreams()` - Used by: StreamManagement
- `useFunctions()` - Used by: DataFetching
- `useActions()` - Used by: DataFetching
- `useNotifications()` - Used by: Multiple composables
- `useQuery()` - Used by: QueryProcessing

#### **Store Dependencies:**
- `store.state.zoConfig.*` - Used by: Multiple composables
- `store.state.organizationData.*` - Used by: DataFetching
- `store.state.refreshIntervalID` - Used by: StateManagement

#### **Router Dependencies:**
- `router.currentRoute.value.query.*` - Used by: URLManagement
- Navigation operations - Used by: URLManagement

### 8. Data Flow Optimization Strategies

#### **Lazy Loading:**
```typescript
// Only initialize composables when needed
const histogramManagement = computed(() => 
  showHistogram.value ? useLogsHistogramManagement(state) : null
);
```

#### **Memoization:**
```typescript
// Cache expensive computations
const memoizedBuildSearch = useMemoize(
  () => buildSearch(),
  () => [query.value, selectedStreams.value, sqlMode.value]
);
```

#### **Debouncing:**
```typescript
// Debounce frequent updates
const debouncedUpdateQuery = useDebounceFn(
  (query: string) => updateQuery(query),
  300
);
```

### 9. Migration Strategy for Dependencies

#### **Phase 1: Extract Independent Composables**
```
URLManagement ← StateManagement
  ↑
  No circular dependencies, easy to extract
```

#### **Phase 2: Extract Dependent Composables**  
```
StreamManagement ← StateManagement
QueryProcessing ← StateManagement + StreamManagement
Pagination ← StateManagement
```

#### **Phase 3: Extract Complex Composables**
```
DataFetching ← All previous composables
HistogramManagement ← QueryProcessing + DataFetching
WebSocketHandling ← DataFetching
GridManagement ← DataFetching + Pagination
```

### 10. Testing Strategy for Dependencies

#### **Unit Testing:**
- Mock dependencies for isolated testing
- Test each composable independently
- Verify function contracts and interfaces

#### **Integration Testing:**
- Test cross-composable communication
- Verify data flow between composables
- Test error propagation

#### **End-to-End Testing:**
- Test complete user workflows
- Verify UI updates with data changes
- Test real API interactions

This dependency analysis provides a clear roadmap for refactoring the monolithic `useLogs.ts` file while maintaining all functionality and ensuring proper separation of concerns.